if (!window.console) {
    window.console = {log: function() {}};
}
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
    }
    function writeNetscape(path, data) {
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
    }
    function existsNetscape(path) {
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
    }
    function listNetscape(path, create) {
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
    }
    function acquireLockNetscape(path) {
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
    }
    function releaseLockNetscape(path) {
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

var Crypto = (function() {
/*
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */

/*
 * Configurable variables. You may need to tweak these to be compatible with
 * the server-side, but the defaults work in most cases.
 */
var hexcase = 0;   /* hex output format. 0 - lowercase; 1 - uppercase        */
var b64pad  = "";  /* base-64 pad character. "=" for strict RFC compliance   */

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function hex_md5(s)    { return rstr2hex(rstr_md5(str2rstr_utf8(s))); }
function b64_md5(s)    { return rstr2b64(rstr_md5(str2rstr_utf8(s))); }
function any_md5(s, e) { return rstr2any(rstr_md5(str2rstr_utf8(s)), e); }
function hex_hmac_md5(k, d)
  { return rstr2hex(rstr_hmac_md5(str2rstr_utf8(k), str2rstr_utf8(d))); }
function b64_hmac_md5(k, d)
  { return rstr2b64(rstr_hmac_md5(str2rstr_utf8(k), str2rstr_utf8(d))); }
function any_hmac_md5(k, d, e)
  { return rstr2any(rstr_hmac_md5(str2rstr_utf8(k), str2rstr_utf8(d)), e); }

/*
 * Perform a simple self-test to see if the VM is working
 */
function md5_vm_test()
{
  return hex_md5("abc").toLowerCase() == "900150983cd24fb0d6963f7d28e17f72";
}

/*
 * Calculate the MD5 of a raw string
 */
function rstr_md5(s)
{
  return binl2rstr(binl_md5(rstr2binl(s), s.length * 8));
}

/*
 * Calculate the HMAC-MD5, of a key and some data (raw strings)
 */
function rstr_hmac_md5(key, data)
{
  var bkey = rstr2binl(key);
  if(bkey.length > 16) bkey = binl_md5(bkey, key.length * 8);

  var ipad = Array(16), opad = Array(16);
  for(var i = 0; i < 16; i++)
  {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  var hash = binl_md5(ipad.concat(rstr2binl(data)), 512 + data.length * 8);
  return binl2rstr(binl_md5(opad.concat(hash), 512 + 128));
}

/*
 * Convert a raw string to a hex string
 */
function rstr2hex(input)
{
  try { hexcase } catch(e) { hexcase=0; }
  var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
  var output = "";
  var x;
  for(var i = 0; i < input.length; i++)
  {
    x = input.charCodeAt(i);
    output += hex_tab.charAt((x >>> 4) & 0x0F)
           +  hex_tab.charAt( x        & 0x0F);
  }
  return output;
}

/*
 * Convert a raw string to a base-64 string
 */
function rstr2b64(input)
{
  try { b64pad } catch(e) { b64pad=''; }
  var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = "";
  var len = input.length;
  for(var i = 0; i < len; i += 3)
  {
    var triplet = (input.charCodeAt(i) << 16)
                | (i + 1 < len ? input.charCodeAt(i+1) << 8 : 0)
                | (i + 2 < len ? input.charCodeAt(i+2)      : 0);
    for(var j = 0; j < 4; j++)
    {
      if(i * 8 + j * 6 > input.length * 8) output += b64pad;
      else output += tab.charAt((triplet >>> 6*(3-j)) & 0x3F);
    }
  }
  return output;
}

/*
 * Convert a raw string to an arbitrary string encoding
 */
function rstr2any(input, encoding)
{
  var divisor = encoding.length;
  var i, j, q, x, quotient;

  /* Convert to an array of 16-bit big-endian values, forming the dividend */
  var dividend = Array(Math.ceil(input.length / 2));
  for(i = 0; i < dividend.length; i++)
  {
    dividend[i] = (input.charCodeAt(i * 2) << 8) | input.charCodeAt(i * 2 + 1);
  }

  /*
   * Repeatedly perform a long division. The binary array forms the dividend,
   * the length of the encoding is the divisor. Once computed, the quotient
   * forms the dividend for the next step. All remainders are stored for later
   * use.
   */
  var full_length = Math.ceil(input.length * 8 /
                                    (Math.log(encoding.length) / Math.log(2)));
  var remainders = Array(full_length);
  for(j = 0; j < full_length; j++)
  {
    quotient = Array();
    x = 0;
    for(i = 0; i < dividend.length; i++)
    {
      x = (x << 16) + dividend[i];
      q = Math.floor(x / divisor);
      x -= q * divisor;
      if(quotient.length > 0 || q > 0)
        quotient[quotient.length] = q;
    }
    remainders[j] = x;
    dividend = quotient;
  }

  /* Convert the remainders to the output string */
  var output = "";
  for(i = remainders.length - 1; i >= 0; i--)
    output += encoding.charAt(remainders[i]);

  return output;
}

/*
 * Encode a string as utf-8.
 * For efficiency, this assumes the input is valid utf-16.
 */
function str2rstr_utf8(input)
{
  var output = "";
  var i = -1;
  var x, y;

  while(++i < input.length)
  {
    /* Decode utf-16 surrogate pairs */
    x = input.charCodeAt(i);
    y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
    if(0xD800 <= x && x <= 0xDBFF && 0xDC00 <= y && y <= 0xDFFF)
    {
      x = 0x10000 + ((x & 0x03FF) << 10) + (y & 0x03FF);
      i++;
    }

    /* Encode output as utf-8 */
    if(x <= 0x7F)
      output += String.fromCharCode(x);
    else if(x <= 0x7FF)
      output += String.fromCharCode(0xC0 | ((x >>> 6 ) & 0x1F),
                                    0x80 | ( x         & 0x3F));
    else if(x <= 0xFFFF)
      output += String.fromCharCode(0xE0 | ((x >>> 12) & 0x0F),
                                    0x80 | ((x >>> 6 ) & 0x3F),
                                    0x80 | ( x         & 0x3F));
    else if(x <= 0x1FFFFF)
      output += String.fromCharCode(0xF0 | ((x >>> 18) & 0x07),
                                    0x80 | ((x >>> 12) & 0x3F),
                                    0x80 | ((x >>> 6 ) & 0x3F),
                                    0x80 | ( x         & 0x3F));
  }
  return output;
}

/*
 * Encode a string as utf-16
 */
function str2rstr_utf16le(input)
{
  var output = "";
  for(var i = 0; i < input.length; i++)
    output += String.fromCharCode( input.charCodeAt(i)        & 0xFF,
                                  (input.charCodeAt(i) >>> 8) & 0xFF);
  return output;
}

function str2rstr_utf16be(input)
{
  var output = "";
  for(var i = 0; i < input.length; i++)
    output += String.fromCharCode((input.charCodeAt(i) >>> 8) & 0xFF,
                                   input.charCodeAt(i)        & 0xFF);
  return output;
}

/*
 * Convert a raw string to an array of little-endian words
 * Characters >255 have their high-byte silently ignored.
 */
function rstr2binl(input)
{
  var output = Array(input.length >> 2);
  for(var i = 0; i < output.length; i++)
    output[i] = 0;
  for(var i = 0; i < input.length * 8; i += 8)
    output[i>>5] |= (input.charCodeAt(i / 8) & 0xFF) << (i%32);
  return output;
}

/*
 * Convert an array of little-endian words to a string
 */
function binl2rstr(input)
{
  var output = "";
  for(var i = 0; i < input.length * 32; i += 8)
    output += String.fromCharCode((input[i>>5] >>> (i % 32)) & 0xFF);
  return output;
}

/*
 * Calculate the MD5 of an array of little-endian words, and a bit length.
 */
function binl_md5(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << ((len) % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;

    a = md5_ff(a, b, c, d, x[i+ 0], 7 , -680876936);
    d = md5_ff(d, a, b, c, x[i+ 1], 12, -389564586);
    c = md5_ff(c, d, a, b, x[i+ 2], 17,  606105819);
    b = md5_ff(b, c, d, a, x[i+ 3], 22, -1044525330);
    a = md5_ff(a, b, c, d, x[i+ 4], 7 , -176418897);
    d = md5_ff(d, a, b, c, x[i+ 5], 12,  1200080426);
    c = md5_ff(c, d, a, b, x[i+ 6], 17, -1473231341);
    b = md5_ff(b, c, d, a, x[i+ 7], 22, -45705983);
    a = md5_ff(a, b, c, d, x[i+ 8], 7 ,  1770035416);
    d = md5_ff(d, a, b, c, x[i+ 9], 12, -1958414417);
    c = md5_ff(c, d, a, b, x[i+10], 17, -42063);
    b = md5_ff(b, c, d, a, x[i+11], 22, -1990404162);
    a = md5_ff(a, b, c, d, x[i+12], 7 ,  1804603682);
    d = md5_ff(d, a, b, c, x[i+13], 12, -40341101);
    c = md5_ff(c, d, a, b, x[i+14], 17, -1502002290);
    b = md5_ff(b, c, d, a, x[i+15], 22,  1236535329);

    a = md5_gg(a, b, c, d, x[i+ 1], 5 , -165796510);
    d = md5_gg(d, a, b, c, x[i+ 6], 9 , -1069501632);
    c = md5_gg(c, d, a, b, x[i+11], 14,  643717713);
    b = md5_gg(b, c, d, a, x[i+ 0], 20, -373897302);
    a = md5_gg(a, b, c, d, x[i+ 5], 5 , -701558691);
    d = md5_gg(d, a, b, c, x[i+10], 9 ,  38016083);
    c = md5_gg(c, d, a, b, x[i+15], 14, -660478335);
    b = md5_gg(b, c, d, a, x[i+ 4], 20, -405537848);
    a = md5_gg(a, b, c, d, x[i+ 9], 5 ,  568446438);
    d = md5_gg(d, a, b, c, x[i+14], 9 , -1019803690);
    c = md5_gg(c, d, a, b, x[i+ 3], 14, -187363961);
    b = md5_gg(b, c, d, a, x[i+ 8], 20,  1163531501);
    a = md5_gg(a, b, c, d, x[i+13], 5 , -1444681467);
    d = md5_gg(d, a, b, c, x[i+ 2], 9 , -51403784);
    c = md5_gg(c, d, a, b, x[i+ 7], 14,  1735328473);
    b = md5_gg(b, c, d, a, x[i+12], 20, -1926607734);

    a = md5_hh(a, b, c, d, x[i+ 5], 4 , -378558);
    d = md5_hh(d, a, b, c, x[i+ 8], 11, -2022574463);
    c = md5_hh(c, d, a, b, x[i+11], 16,  1839030562);
    b = md5_hh(b, c, d, a, x[i+14], 23, -35309556);
    a = md5_hh(a, b, c, d, x[i+ 1], 4 , -1530992060);
    d = md5_hh(d, a, b, c, x[i+ 4], 11,  1272893353);
    c = md5_hh(c, d, a, b, x[i+ 7], 16, -155497632);
    b = md5_hh(b, c, d, a, x[i+10], 23, -1094730640);
    a = md5_hh(a, b, c, d, x[i+13], 4 ,  681279174);
    d = md5_hh(d, a, b, c, x[i+ 0], 11, -358537222);
    c = md5_hh(c, d, a, b, x[i+ 3], 16, -722521979);
    b = md5_hh(b, c, d, a, x[i+ 6], 23,  76029189);
    a = md5_hh(a, b, c, d, x[i+ 9], 4 , -640364487);
    d = md5_hh(d, a, b, c, x[i+12], 11, -421815835);
    c = md5_hh(c, d, a, b, x[i+15], 16,  530742520);
    b = md5_hh(b, c, d, a, x[i+ 2], 23, -995338651);

    a = md5_ii(a, b, c, d, x[i+ 0], 6 , -198630844);
    d = md5_ii(d, a, b, c, x[i+ 7], 10,  1126891415);
    c = md5_ii(c, d, a, b, x[i+14], 15, -1416354905);
    b = md5_ii(b, c, d, a, x[i+ 5], 21, -57434055);
    a = md5_ii(a, b, c, d, x[i+12], 6 ,  1700485571);
    d = md5_ii(d, a, b, c, x[i+ 3], 10, -1894986606);
    c = md5_ii(c, d, a, b, x[i+10], 15, -1051523);
    b = md5_ii(b, c, d, a, x[i+ 1], 21, -2054922799);
    a = md5_ii(a, b, c, d, x[i+ 8], 6 ,  1873313359);
    d = md5_ii(d, a, b, c, x[i+15], 10, -30611744);
    c = md5_ii(c, d, a, b, x[i+ 6], 15, -1560198380);
    b = md5_ii(b, c, d, a, x[i+13], 21,  1309151649);
    a = md5_ii(a, b, c, d, x[i+ 4], 6 , -145523070);
    d = md5_ii(d, a, b, c, x[i+11], 10, -1120210379);
    c = md5_ii(c, d, a, b, x[i+ 2], 15,  718787259);
    b = md5_ii(b, c, d, a, x[i+ 9], 21, -343485551);

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
  }
  return Array(a, b, c, d);
}

/*
 * These functions implement the four basic operations the algorithm uses.
 */
function md5_cmn(q, a, b, x, s, t)
{
  return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s),b);
}
function md5_ff(a, b, c, d, x, s, t)
{
  return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
}
function md5_gg(a, b, c, d, x, s, t)
{
  return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
}
function md5_hh(a, b, c, d, x, s, t)
{
  return md5_cmn(b ^ c ^ d, a, b, x, s, t);
}
function md5_ii(a, b, c, d, x, s, t)
{
  return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}

return {'md5': function(data) { return any_md5(data, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'); }};

})();
