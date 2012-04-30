#!/bin/bash

if [ -z "$1" ]
then
    echo "Usage: $0 target"
    echo "Example: $0 http://localhost:5984/notebrowser"
    exit
fi 

couchappdir=$(readlink -f $(dirname $0))
(
cd "$couchappdir"
cp -r "../"{src,lib,index.html} "./_attachments/"
couchapp push "$1"
)
