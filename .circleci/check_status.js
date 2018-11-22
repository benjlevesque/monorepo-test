const fetch = require("node-fetch");
const fs = require("fs");
const child_process = require("child_process");
const util = require("util");
const path = require("path");
const base64 = require("base-64");

// #region Promisify
const sleep = util.promisify(setTimeout);
const readdir = util.promisify(fs.readdir);
const exists = util.promisify(fs.exists);
const readFile = util.promisify(fs.readFile);
const exec = util.promisify(child_process.exec);
// #endregion

const {
  CIRCLE_PROJECT_REPONAME,
  CIRCLE_PROJECT_USERNAME,
  CIRCLE_BRANCH,
  CIRCLE_TOKEN
} = process.env;

const circle_ci_api_base = "https://circleci.com/api/v1.1/project/github";
const circleApiUrl = (path, appendToken = true) =>
  `${circle_ci_api_base}/${CIRCLE_PROJECT_USERNAME}/${CIRCLE_PROJECT_REPONAME}/${path}${
    appendToken ? `?circle-token=${CIRCLE_TOKEN}` : ""
  }`;

const circleUrl = path =>
  `https://circleci.com/gh/${CIRCLE_PROJECT_USERNAME}/${CIRCLE_PROJECT_REPONAME}/${path}`;

const queueBuild = async configPath => {
  const apiUrl = circleApiUrl(`tree/${CIRCLE_BRANCH}`, false);

  const { err, stderr, stdout } = await exec(
    `curl -s -u ${CIRCLE_TOKEN}: --request POST --form "config=@${configPath}" ${apiUrl}`
  );
  const json = JSON.parse(stdout);
  return json.build_num;
};

const triggerBuilds = async () => {
  const { err, stdout, stderr } = await exec(
    "git --no-pager diff --no-commit-id --name-only -r `git log -n 2 --oneline --pretty=format:\"%h\" | tail -n1` | grep 'packages' | cut -d/ -f2 | sort -u"
  );
  if (err) {
    throw new Error(stderr);
  }
  const modified_packages = stdout.split("\n").filter(p => p !== "");
  const existing_packages = await readdir("packages");
  const to_build = modified_packages.filter(
    value => -1 !== existing_packages.indexOf(value)
  );
  console.log({ modified_packages, existing_packages, to_build });
  const buildIds = {};
  for (const pack of modified_packages) {
    const ci_config_path = path.join(
      "packages",
      pack,
      ".circleci",
      "config.yml"
    );
    if (!(await exists(ci_config_path))) {
      console.log(`${ci_config_path} not found, skipping ${pack}`);
      continue;
    }
    const build_num = await queueBuild(ci_config_path);
    buildIds[pack] = build_num;
  }

  return buildIds;
};

const checkBuilds = async builds => {
  let finished = false;
  let statuses = {};
  while (!finished) {
    await sleep(5000);
    for (const pack in builds) {
      const buildNum = builds[pack];
      const response = await fetch(circleApiUrl(buildNum));
      const { lifecycle, outcome, status } = await response.json();
      // "lifecycle" : "finished", // :queued, :scheduled, :not_run, :not_running, :running or :finished
      // "outcome" : "success", // :canceled, :infrastructure_fail, :timedout, :failed, :no_tests or :success
      // "status" : "success", // :retried, :canceled, :infrastructure_fail, :timedout, :not_run, :running, :failed, :queued, :scheduled, :not_running, :no_tests, :fixed, :success

      statuses[pack] = {
        buildNum,
        lifecycle,
        outcome,
        status
      };
    }

    const queue = Object.values(statuses).filter(
      s => s.lifecycle !== "finished"
    );
    const queue_length = queue.length;
    finished = queue_length == 0;
    // console.log({ queue_length, statuses });
    console.log(`${queue_length} builds left...`);
  }

  let exitCode = 0;
  const errors = Object.values(statuses).filter(s => s.status !== "success");
  if (errors.length > 0) {
    exitCode = 1;
    console.log("One or more builds failed:");
    for (const error of errors) {
      const buildId = error.buildNum;
      console.log(`\t- Build #${buildId}`, {
        ...error,
        url: circleUrl(buildId)
      });
    }
  }
  return exitCode;
};

void (async function() {
  const builds = await triggerBuilds();
  const exitCode = await checkBuilds(builds);
  process.exit(exitCode);
})();
