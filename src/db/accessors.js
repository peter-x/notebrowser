define(['jquery'], function($) {
"use strict";


function urlToLocalPath(url) {
    if (url.substr(0, 7) == "file://") {
        return url.substr(7);
    } else {
        return url;
    }
}

function tryNetscape() {
    try {
        netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
        var file = Components.classes["@mozilla.org/file/local;1"]
                        .createInstance(Components.interfaces.nsILocalFile);
    } catch (e) {
        return false;
    }
    return true;
}
var javaLoader;

function tryJava() {
    $(function() {
        $(document.body).append('<applet style="position: absolute; left: -1px;" ' +
                            'name="FSAccessor" code="FSAccessor" ' +
                            'archive="FSAccessor.jar" width="1" height="1"></applet>');
    });
    var d = $.Deferred();
    var ttl = 6000;
    function checkIfAppletInitialized() {
        if (document.applets["FSAccessor"] && 'write' in document.applets["FSAccessor"]) {
            d.resolve(document.applets["FSAccessor"]);
        } else {
            ttl -= 200;
            if (ttl < 0) {
                d.reject("Error running or accessing Java applet.");
            } else {
                window.setTimeout(checkIfAppletInitialized, 200);
            }
        }
    }
    checkIfAppletInitialized();
    return d;
}

var WebDAVAccessor = {
    /* XXX better error messages */
    read: function(path) {
        console.log("Request to read  " + path);
        return $.ajax({url: path,
                       /* XXX extract it from path */
                       username: 'test',
                       password: 'test',
                       dataType: 'text'})
            .pipe(null, function() { return $.Deferred().reject("Read error.").promise(); });
    },
    write: function(path, data) {
        console.log("Request to write " + path);
        return $.ajax({url: path,
                       /* XXX extract it from path */
                       username: 'test',
                       password: 'test',
                       data: data,
                       contentType: '',
                       type: 'PUT',
                       dataType: 'text'})
            .pipe(function() {
                return true;
            }, function() { return $.Deferred().reject("Write error.").promise(); });
    },
    exists: function(path) {
        console.log("Request to exist " + path);
        return $.ajax({url: path,
                       /* XXX extract it from path */
                       username: 'test',
                       password: 'test',
                       type: 'HEAD'})
            .pipe(function() {
                return true;
            }, function(jqXHR) {
                if (jqXHR.status == '301' || jqXHR.status == '302') {
                    return $.when(true).promise();
                } else {
                    return $.when(false).promise();
                }
            });
    },
    list: function(path, create) {
        /* TODO honour "create" */
        if (path[path.length - 1] !== '/')
            path += '/';

        var m = path.match(/(https?:\/\/[^\/]*)(\/.*)/);
        var requestHost = m[1];
        var requestPath = m[2];

        console.log("Request to list  " + path);
        var requestData = '<?xml version="1.0" encoding="utf-8" ?>' +
                           '<propfind xmlns="DAV:"><prop></prop></propfind>';
        return $.ajax({url: path,
                       /* XXX extract it from path */
                       username: 'test',
                       password: 'test',
                       type: 'PROPFIND',
                       contentType: 'application/xml',
                       headers: {Depth: '1'},
                       data: requestData})
            .pipe(function(data) {
                var entries = [];
                $('response', data).each(function(i, el) {
                    var elPath = $('href', el).text();
                    /* strip hostname */
                    elPath = elPath.replace(/^https?:\/\/[^\/]*/, '');
                    if (elPath.substr(0, requestPath.length) === requestPath) {
                        var el = elPath.substr(requestPath.length, elPath.length);
                        if (el !== '' && el !== '/') {
                            entries.push(el);
                        }
                    }
                });
                return entries;
            }, function() { return $.Deferred().reject("List error.").promise() });
    },
    acquireLock: function(path) {
        console.log("Request to lock  " + path);
        /* TODO */
        return $.when(true).promise();
    },
    releaseLock: function(path) {
        console.log("Request to ulock " + path);
        /* TODO */
        return $.when(true).promise();
    }
}

var JavaAccessor = {
    read: function(path) {
        console.log("Request to read  " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                var data = applet.read(path + "\0\0\0\0");
                if (data === null) {
                    return $.Deferred().reject("File not found.").promise();
                } else {
                    return data;
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    },
    write: function(path, data) {
        console.log("Request to write " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                if (applet.write(path + "\0\0\0\0", data + "\0\0\0\0") == 1) {
                    return true;
                } else {
                    return $.Deferred().reject("Error writing file.").promise();
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    },
    exists: function(path) {
        console.log("Request to exist " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                var ret = applet.exists(path + "\0\0\0\0");
                if (ret == 1) {
                    return true;
                } else if (ret == 0) {
                    return false;
                } else {
                    return $.Deferred().reject("Error accessing file.").promise();
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    },
    list: function(path, create) {
        console.log("Request to list  " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                var ret = applet.list(path + "\0\0\0\0", create);
                if (ret === null) {
                    return $.Deferred().reject("Error listing files.").promise();
                } else {
                    return ('' + ret).split(',').map(function(t) {
                        return t.replace('\\c', ',').replace('\\b', '\\');
                    });
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    },
    acquireLock: function(path) {
        console.log("Request to lock  " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                var ret = applet.acquireLock(path + "\0\0\0\0");
                if (ret === 0) {
                    return $.Deferred().reject("Error acquiring lock.").promise();
                } else if (ret === 1) {
                    return $.when(true);
                } else {
                    return $.when(false, -ret);
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    },
    releaseLock: function(path) {
        console.log("Request to ulock " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                if (applet.releaseLock(path + "\0\0\0\0") === 0) {
                    return $.Deferred().reject("Error releasing lock.").promise();
                } else {
                    return true;
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    }
}

var NetscapeAccessor = {
    read: function(path) {
        console.log("Request to read  " + path);
        try {
            path = urlToLocalPath(path);
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var file = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath(path);
            if (!file.exists())
                return $.Deferred().reject("File not found: " + path).promise();
            var inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                .createInstance(Components.interfaces.nsIFileInputStream);
            inputStream.init(file, 0x01, 0x04, null);
            var contents = '';
            var convStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
                                .createInstance(Components.interfaces.nsIConverterInputStream);
            convStream.init(inputStream, null, 0, 0);
            var o = {};
            while (convStream.readString(0x1ffffff, o) > 0) {
                contents += o.value;
                o = {};
            }
            convStream.close();
            inputStream.close();

            return $.when(contents);
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    },
    write: function(path, data) {
        console.log("Request to write " + path);
        try {
            path = urlToLocalPath(path);
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var file = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath(path);
            if (!file.exists())
                file.create(0, 0x01B4);
            var outputStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                            .createInstance(Components.interfaces.nsIFileOutputStream);
            outputStream.init(file, 0x22, 0x04, null);
            var convStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
                                .createInstance(Components.interfaces.nsIConverterOutputStream);
            convStream.init(outputStream, null, 0, 0);
            /* XXX use asynchronous IO */
            convStream.writeString(data);
            convStream.close();
            outputStream.close();

            return $.when(true);
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    },
    exists: function(path) {
        console.log("Request to exist " + path);
        try {
            path = urlToLocalPath(path);
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var file = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath(path);
            return $.when(file.exists());
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    },
    list: function(path, create) {
        console.log("Request to list  " + path);
        var files = [];
        try {
            path = urlToLocalPath(path);
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var dir = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            dir.initWithPath(path);
            if (!dir.exists()) {
                if (create) {
                    dir.create(1, 0x1FD); 
                } else {
                    return $.Deferred().reject("File not found.").promise();
                }
            } else if (!dir.isDirectory()) {
                return $.Deferred().reject("File is not a directory.").promise();
            }
            var entries = dir.directoryEntries;
            while (entries.hasMoreElements()) {
                var name = entries.getNext().QueryInterface(Components.interfaces.nsILocalFile).leafName;
                files.push(name);
            }

            return $.when(files);
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    },
    acquireLock: function(path) {
        console.log("Request to lock  " + path);
        try {
            path = urlToLocalPath(path);
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var file = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath(path);
            file.create(0, 0x01B4);
            return $.when(true);
        } catch (e) {
            if ('name' in e && e.name === "NS_ERROR_FILE_ALREADY_EXISTS") {
                var age = (new Date()) - file.lastModifiedTime;
                return $.when(false, age);
            } else {
                return $.Deferred().reject(e.message).promise();
            }
        }
    },
    releaseLock: function(path) {
        console.log("Request to ulock " + path);
        try {
            path = urlToLocalPath(path);
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var file = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath(path);
            file.remove(false);
            return $.when(true);
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    }
}

return function(path) {
    if (path.substr(0, 7) === 'http://') {
        return WebDAVAccessor;
    } else if (tryNetscape()) {
        return NetscapeAccessor;
    } else {
        javaLoader = tryJava();
        return JavaAccessor;
    }
}
});
