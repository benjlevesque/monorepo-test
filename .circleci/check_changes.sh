#! /bin/bash

# Find list of packages 
find ./packages/*/package.json -maxdepth 2 -type f | xargs -l1 dirname | xargs -l1 basename > package_list
printf "Available packages:\n"
cat package_list

# Create empty file
echo "" > projects

echo "Check which packages has been modified"
##
git --no-pager diff --no-commit-id --name-only -r `git log -n 2 --oneline --pretty=format:"%h" | tail -n1` | grep 'packages' | cut -d/ -f2 | sort -u >  packages_files
while read file; do
    if grep -Fxq $file package_list; then
    echo $file>>projects
    fi
done<packages_files

##
echo "Remove duplicates"
##
echo "$(sort -u projects)" > projects

echo "Project to build:"
cat projects

##
echo "Run builds"
##
while read project; do
    if [ -z $project ] ; then
        continue
    fi
    printf "== %s == \n" $project
    configpath="packages/$project/.circleci/config.yml"
    if [ -f $configpath ]; then
        printf "Triggerring build for %s (%s) \n" $project $configpath
        curl -s -u ${CIRCLE_TOKEN}: --request POST --form "config=@$configpath" https://circleci.com/api/v1.1/project/github/$O/$R/tree/$CIRCLE_BRANCH
        # TODO can be improved with https://circleci.com/docs/api/v1-reference/#new-project-build when build_parameters are available (not yet as of 21/11/2018)
    else
        printf "No build for %s (%s not found) \n" $project $configpath
    fi
    printf "\n"
done <projects

##
echo "Finished"
##
