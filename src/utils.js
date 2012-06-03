/* Simple JavaScript Inheritance
 * By John Resig http://ejohn.org/
 * MIT Licensed.
 */
// Inspired by base2 and Prototype
var Class = (function(){
  var initializing = false, fnTest = /xyz/.test(function(){xyz;}) ? /\b_super\b/ : /.*/;
  // The base Class implementation (does nothing)
  var Class = function(){};
  
  // Create a new Class that inherits from this class
  Class.extend = function(prop) {
    var _super = this.prototype;
    
    // Instantiate a base class (but only create the instance,
    // don't run the init constructor)
    initializing = true;
    var prototype = new this();
    initializing = false;
    
    // Copy the properties over onto the new prototype
    for (var name in prop) {
      // Check if we're overwriting an existing function
      prototype[name] = typeof prop[name] == "function" && 
        typeof _super[name] == "function" && fnTest.test(prop[name]) ?
        (function(name, fn){
          return function() {
            var tmp = this._super;
            
            // Add a new ._super() method that is the same method
            // but on the super-class
            this._super = _super[name];
            
            // The method only need to be bound temporarily, so we
            // remove it when we're done executing
            var ret = fn.apply(this, arguments);        
            this._super = tmp;
            
            return ret;
          };
        })(name, prop[name]) :
        prop[name];
    }
    
    // The dummy class constructor
    function Class() {
      // All construction is actually done in the init method
      if ( !initializing && this._init )
        this._init.apply(this, arguments);
    }
    
    // Populate our constructed prototype object
    Class.prototype = prototype;
    
    // Enforce the constructor to be what we expect
    Class.prototype.constructor = Class;

    // And make this class extendable
    Class.extend = arguments.callee;
    
    return Class;
  };
  return Class;
})();

/** Makes the specified class events-aware, i.e. adds
 * the functions on(event, handler), off(event, handler)
 * and _trigger(event, ...)
 */
function addEvents(className, possibleEvents) {
    className.prototype.on = function(event, handler) {
        if (!this._eventHandlers)
            this._initEvents();

        this._eventHandlers[event].push(handler);

        return handler;
    },
    className.prototype.off = function(event, handler) {
        var hand = this._eventHandlers[event];
        for (var i = 0; i < hand.length; i ++) {
            if (hand[i] === handler) {
                hand.splice(i, 1);
                i --;
            }
        }
        this._eventHandlers[event] = hand;
    },
    className.prototype._initEvents = function() {
        this._eventHandlers = {};
        var lthis = this;
        $(possibleEvents).each(function(i, e) { lthis._eventHandlers[e] = []; });
    },
    /* can be called with more arguments */
    className.prototype._trigger = function(event) {
        if (!this._eventHandlers)
            this._initEvents();
        
        var hand = this._eventHandlers[event];
        var args = [].slice.call(arguments, 1);
        for (var i = 0; i < hand.length; i ++) {
            hand[i].apply(this, args);
        }
    }
}

var LocalFileInterface = (function() {
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

    function readJava(path) {
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
    }
    function writeJava(path, data) {
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
    }
    function existsJava(path) {
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
    }
    function listJava(path, create) {
        console.log("Request to list  " + path);
        return javaLoader.pipe(function(applet) {
            try {
                path = urlToLocalPath(path);
                var ret = applet.list(path + "\0\0\0\0", create);
                if (ret === null) {
                    return $.Deferred().reject("Error listing files.").promise();
                } else {
                    var list = [];
                    for (var i = 0; ret[i] !== undefined; i ++) {
                        list[i] = ret[i];
                    }
                    return list;
                }
            } catch (e) {
                return $.Deferred().reject(e.message).promise();
            }
        });
    }
    function acquireLockJava(path) {
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
    }
    function releaseLockJava(path) {
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

    function readNetscape(path) {
        try {
            netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
            var file = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
            file.initWithPath(path);
            if (!file.exists())
                return $.Deferred().reject("File not found: " + path).promise();
            var inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                .createInstance(Components.interfaces.nsIFileInputStream);
            inputStream.init(file, 0x01, 0x04, null);
            var sInputStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                                .createInstance(Components.interfaces.nsIScriptableInputStream);
            sInputStream.init(inputStream);
            /* XXX use asynchronous IO */
            var contents = sInputStream.read(sInputStream.available());
            sInputStream.close();
            inputStream.close();

            return $.when(contents);
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    }
    function writeNetscape(path, data) {
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

            /* XXX use asynchronous IO */
            outputStream.write(data, data.length);
            outputStream.close();

            return $.when(true);
        } catch (e) {
            return $.Deferred().reject(e.message).promise();
        }
    }
    function existsNetscape(path) {
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
    }
    function listNetscape(path, create) {
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
    }
    function acquireLockNetscape(path) {
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
                var age = (new Date()) - file.lastModifiedTime();
                return $.when(false, age);
            } else {
                return $.Deferred().reject(e.message).promise();
            }
        }
    }
    function releaseLockNetscape(path) {
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

    if (tryNetscape()) {
        return {read: readNetscape, write: writeNetscape, list: listNetscape,
                exists: existsNetscape,
                acquireLock: acquireLockNetscape, releaseLock: releaseLockNetscape};
    } else {
        javaLoader = tryJava();
        return {read: readJava, write: writeJava, list: listJava,
                exists: existsJava,
                acquireLock: acquireLockJava, releaseLock: releaseLockJava};
    }

})();

function LiveValue(initial) {
    this._val = initial;
}
LiveValue.prototype = {
    get: function() {
        return this._val;
    },
    getLive: function(callback, owner) {
        callback(this._val);
        this.on('changed', callback);

        if (owner !== undefined) {
            var lthis = this;
            owner.on('destroying', function() {
                lthis.off('changed', callback);
            });
        }
    },
    set: function(val) {
        this._val = val;
        this._trigger('changed', val);
    }

}
addEvents(LiveValue, ['changed']);

/* TODO check if this works */
function HashTable(arg) {
    if (arg) {
        for (var i = 0; i < arg.length; i ++)
            this[arg[i]] = null;
    }
}
/* use as set */
HashTable.prototype.insert = function(key) {
    this[key] = null;
}
HashTable.prototype.remove = function(key) {
    delete this[key];
}
HashTable.prototype.keys = function() {
    return $.map(this, function(value, key) { return key; });
}
HashTable.prototype.values = function() {
    return $.map(this, function(value, key) { return value; });
}
HashTable.prototype.set = function() {
    return new HashTable(this.keys());
}

var DeferredSynchronizer = function(args) {
   var length = args.length,
        errors = {},
        count = length,
        deferred = $.Deferred();

    if (length == 0)
        deferred.resolveWith(deferred, [[], []]);

    function resolveFunc(i) {
        return function(value) {
            args[i] = arguments.length > 1 ? [].slice.call(arguments, 0) : value;
            if (--count === 0) {
                deferred.resolveWith(deferred, [args, errors]);
            }
        };
    }
    function rejectFunc(i) {
        return function(value) {
            errors[i] = arguments.length > 1 ? [].slice.call(arguments, 0) : value;
            args[i] = null;
            if (--count === 0) {
                deferred.resolveWith(deferred, [args, errors]);
            }
        };
    }
    /* TODO progress */
    for (var i = 0; i < args.length; i ++) {
        args[i].promise().then(resolveFunc(i), rejectFunc(i));
    }
    return deferred.promise();
}

var DBObject = Class.extend({
    _init: function(id) {
        this._dbObj = null;

        this._constructorPromise = null;

        if (id === undefined) {
            /* new object, extend this part */
            this._dbObj = {};
            this._constructorPromise = $.when(this);
        } else if (typeof(id) == 'object') {
            /* dircetly passed database object */
            this._dbObj = {};
            this.setDBObj(id);
            this._constructorPromise = $.when(this);
        } else {
            var lthis = this;
            this._constructorPromise = dbInterface.getDoc(id).pipe(function(dbObj) {
                lthis._dbObj = {};
                lthis.setDBObj(dbObj);
                return lthis;
            });
        }
    },
    getID: function() {
        return this._dbObj._id;
    },
    getConstructorPromise: function() {
        return this._constructorPromise;
    },
    /* to be overwritten */
    setDBObj: function(dbObj) {
        if ('_id' in dbObj && '_rev' in dbObj) {
            this._dbObj = dbObj;
        } else {
            throw new Error("Invalid database object.");
        }
    },
    /* modifier is function that takes a copy of this._dbObj and returns
     * modified db object (or promise),
     * changes only take effect after saving,
     * object can already be changed during conflict resolution
     * if modifier returns null, do not save (useful to prevent multiple saves
     * of the same data)
     * options are directly passed on to dbInterface.saveDoc
     */
    _save: function(modifier, options) {
        var lthis = this;

        modifier = modifier || function(dbObj) { return dbObj; };

        var dbObjCopy = $.extend(true, {}, this._dbObj);

        return $.when(modifier(dbObjCopy)).pipe(function(data) {
            if (data === null)
                return lthis;
            return dbInterface.saveDoc(data, options).pipe(function(res) {
                try {
                    lthis.setDBObj(res);
                } catch(e) {
                    return $.Deferred().reject(e.message).promise();
                }
                return lthis;
            }, function(err, conflict) {
                /* XXX most dbs already supply the object in the db */
                if (conflict) {
                    return dbInterface.getDoc(lthis.getID()).pipe(function(currentDBObj) {
                        try {
                            lthis.setDBObj(currentDBObj);
                            return lthis._save(modifier, options);
                        } catch(e) {
                            return e.message;
                        }
                    });
                } else {
                    return err;
                }
            });
        });
    },
    _setAndSave: function(attr, value) {
        return this._save(function(dbObj) {
            if (dbObj[attr] && dbObj[attr] === value)
                return null;
            dbObj[attr] = value;
            return dbObj;
        });
    }
});

var ObjectBag = function(objects) {
    this._objects = {};
    if (objects !== undefined) {
        objects.forEach(function(obj) { this._objects[obj.getID()] = obj; });
    }
}
ObjectBag.prototype.idList = function() {
    return $.map(this._objects, function(v, k) { return k; });
}
ObjectBag.prototype.objectList = function() {
    return $.map(this._objects, function(v, k) { return v; });
}
ObjectBag.prototype.insert = function(obj, id) {
    if (id === undefined) id = obj.getID();
    this._objects[id] = obj;
}
ObjectBag.prototype.hasID = function(id) {
    return id in this._objects;
}
ObjectBag.prototype.get = function(id) {
    return this._objects[id];
}
ObjectBag.prototype.each = function(callback) {
    return $.each(this._objects, callback);
}
ObjectBag.prototype.map = function(callback) {
    return $.map(this._objects, callback);
}

var MD5 = (function() {
/*
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */
var hexcase=0;function hex_md5(a){return rstr2hex(rstr_md5(str2rstr_utf8(a)))}function hex_hmac_md5(a,b){return rstr2hex(rstr_hmac_md5(str2rstr_utf8(a),str2rstr_utf8(b)))}function md5_vm_test(){return hex_md5("abc").toLowerCase()=="900150983cd24fb0d6963f7d28e17f72"}function rstr_md5(a){return binl2rstr(binl_md5(rstr2binl(a),a.length*8))}function rstr_hmac_md5(c,f){var e=rstr2binl(c);if(e.length>16){e=binl_md5(e,c.length*8)}var a=Array(16),d=Array(16);for(var b=0;b<16;b++){a[b]=e[b]^909522486;d[b]=e[b]^1549556828}var g=binl_md5(a.concat(rstr2binl(f)),512+f.length*8);return binl2rstr(binl_md5(d.concat(g),512+128))}function rstr2hex(c){try{hexcase}catch(g){hexcase=0}var f=hexcase?"0123456789ABCDEF":"0123456789abcdef";var b="";var a;for(var d=0;d<c.length;d++){a=c.charCodeAt(d);b+=f.charAt((a>>>4)&15)+f.charAt(a&15)}return b}function str2rstr_utf8(c){var b="";var d=-1;var a,e;while(++d<c.length){a=c.charCodeAt(d);e=d+1<c.length?c.charCodeAt(d+1):0;if(55296<=a&&a<=56319&&56320<=e&&e<=57343){a=65536+((a&1023)<<10)+(e&1023);d++}if(a<=127){b+=String.fromCharCode(a)}else{if(a<=2047){b+=String.fromCharCode(192|((a>>>6)&31),128|(a&63))}else{if(a<=65535){b+=String.fromCharCode(224|((a>>>12)&15),128|((a>>>6)&63),128|(a&63))}else{if(a<=2097151){b+=String.fromCharCode(240|((a>>>18)&7),128|((a>>>12)&63),128|((a>>>6)&63),128|(a&63))}}}}}return b}function rstr2binl(b){var a=Array(b.length>>2);for(var c=0;c<a.length;c++){a[c]=0}for(var c=0;c<b.length*8;c+=8){a[c>>5]|=(b.charCodeAt(c/8)&255)<<(c%32)}return a}function binl2rstr(b){var a="";for(var c=0;c<b.length*32;c+=8){a+=String.fromCharCode((b[c>>5]>>>(c%32))&255)}return a}function binl_md5(p,k){p[k>>5]|=128<<((k)%32);p[(((k+64)>>>9)<<4)+14]=k;var o=1732584193;var n=-271733879;var m=-1732584194;var l=271733878;for(var g=0;g<p.length;g+=16){var j=o;var h=n;var f=m;var e=l;o=md5_ff(o,n,m,l,p[g+0],7,-680876936);l=md5_ff(l,o,n,m,p[g+1],12,-389564586);m=md5_ff(m,l,o,n,p[g+2],17,606105819);n=md5_ff(n,m,l,o,p[g+3],22,-1044525330);o=md5_ff(o,n,m,l,p[g+4],7,-176418897);l=md5_ff(l,o,n,m,p[g+5],12,1200080426);m=md5_ff(m,l,o,n,p[g+6],17,-1473231341);n=md5_ff(n,m,l,o,p[g+7],22,-45705983);o=md5_ff(o,n,m,l,p[g+8],7,1770035416);l=md5_ff(l,o,n,m,p[g+9],12,-1958414417);m=md5_ff(m,l,o,n,p[g+10],17,-42063);n=md5_ff(n,m,l,o,p[g+11],22,-1990404162);o=md5_ff(o,n,m,l,p[g+12],7,1804603682);l=md5_ff(l,o,n,m,p[g+13],12,-40341101);m=md5_ff(m,l,o,n,p[g+14],17,-1502002290);n=md5_ff(n,m,l,o,p[g+15],22,1236535329);o=md5_gg(o,n,m,l,p[g+1],5,-165796510);l=md5_gg(l,o,n,m,p[g+6],9,-1069501632);m=md5_gg(m,l,o,n,p[g+11],14,643717713);n=md5_gg(n,m,l,o,p[g+0],20,-373897302);o=md5_gg(o,n,m,l,p[g+5],5,-701558691);l=md5_gg(l,o,n,m,p[g+10],9,38016083);m=md5_gg(m,l,o,n,p[g+15],14,-660478335);n=md5_gg(n,m,l,o,p[g+4],20,-405537848);o=md5_gg(o,n,m,l,p[g+9],5,568446438);l=md5_gg(l,o,n,m,p[g+14],9,-1019803690);m=md5_gg(m,l,o,n,p[g+3],14,-187363961);n=md5_gg(n,m,l,o,p[g+8],20,1163531501);o=md5_gg(o,n,m,l,p[g+13],5,-1444681467);l=md5_gg(l,o,n,m,p[g+2],9,-51403784);m=md5_gg(m,l,o,n,p[g+7],14,1735328473);n=md5_gg(n,m,l,o,p[g+12],20,-1926607734);o=md5_hh(o,n,m,l,p[g+5],4,-378558);l=md5_hh(l,o,n,m,p[g+8],11,-2022574463);m=md5_hh(m,l,o,n,p[g+11],16,1839030562);n=md5_hh(n,m,l,o,p[g+14],23,-35309556);o=md5_hh(o,n,m,l,p[g+1],4,-1530992060);l=md5_hh(l,o,n,m,p[g+4],11,1272893353);m=md5_hh(m,l,o,n,p[g+7],16,-155497632);n=md5_hh(n,m,l,o,p[g+10],23,-1094730640);o=md5_hh(o,n,m,l,p[g+13],4,681279174);l=md5_hh(l,o,n,m,p[g+0],11,-358537222);m=md5_hh(m,l,o,n,p[g+3],16,-722521979);n=md5_hh(n,m,l,o,p[g+6],23,76029189);o=md5_hh(o,n,m,l,p[g+9],4,-640364487);l=md5_hh(l,o,n,m,p[g+12],11,-421815835);m=md5_hh(m,l,o,n,p[g+15],16,530742520);n=md5_hh(n,m,l,o,p[g+2],23,-995338651);o=md5_ii(o,n,m,l,p[g+0],6,-198630844);l=md5_ii(l,o,n,m,p[g+7],10,1126891415);m=md5_ii(m,l,o,n,p[g+14],15,-1416354905);n=md5_ii(n,m,l,o,p[g+5],21,-57434055);o=md5_ii(o,n,m,l,p[g+12],6,1700485571);l=md5_ii(l,o,n,m,p[g+3],10,-1894986606);m=md5_ii(m,l,o,n,p[g+10],15,-1051523);n=md5_ii(n,m,l,o,p[g+1],21,-2054922799);o=md5_ii(o,n,m,l,p[g+8],6,1873313359);l=md5_ii(l,o,n,m,p[g+15],10,-30611744);m=md5_ii(m,l,o,n,p[g+6],15,-1560198380);n=md5_ii(n,m,l,o,p[g+13],21,1309151649);o=md5_ii(o,n,m,l,p[g+4],6,-145523070);l=md5_ii(l,o,n,m,p[g+11],10,-1120210379);m=md5_ii(m,l,o,n,p[g+2],15,718787259);n=md5_ii(n,m,l,o,p[g+9],21,-343485551);o=safe_add(o,j);n=safe_add(n,h);m=safe_add(m,f);l=safe_add(l,e)}return Array(o,n,m,l)}function md5_cmn(h,e,d,c,g,f){return safe_add(bit_rol(safe_add(safe_add(e,h),safe_add(c,f)),g),d)}function md5_ff(g,f,k,j,e,i,h){return md5_cmn((f&k)|((~f)&j),g,f,e,i,h)}function md5_gg(g,f,k,j,e,i,h){return md5_cmn((f&j)|(k&(~j)),g,f,e,i,h)}function md5_hh(g,f,k,j,e,i,h){return md5_cmn(f^k^j,g,f,e,i,h)}function md5_ii(g,f,k,j,e,i,h){return md5_cmn(k^(f|(~j)),g,f,e,i,h)}function safe_add(a,d){var c=(a&65535)+(d&65535);var b=(a>>16)+(d>>16)+(c>>16);return(b<<16)|(c&65535)}function bit_rol(a,b){return(a<<b)|(a>>>(32-b))};

return {hex_md5: hex_md5};
})();
