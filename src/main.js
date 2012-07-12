requirejs.config({
    enforceDefine: true,
    paths: {
        'crypto': '../lib/crypto',
        'class': '../lib/class',
        'showdown': '../lib/showdown',
        'bootstrap': '../lib/bootstrap/js/bootstrap',
    },
    shim: {
        bootstrap: {
            deps: ['jquery'],
            exports: "$.fn.typeahead" /* only one of its modules */
        }
    }
});

if (!window.console) {
    window.console = {log: function() {}, trace: function() {}};
}

/* load the application */
define(['ui/notebrowser', 'ui/notelist', 'ui/synctargetlist'], function(noteBrowser, noteList) {

});
