define(['jquery', 'bootstrap'], function($, bootstrap) {
"use strict";

return {
    showError: function(message) {
        $('<div class="alert alert-error"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
            .append($('<p/>')
                .text(String(message)))
            .alert()
            .appendTo('#messageArea');
    },
    showInfo: function(message, box, rich) {
        if (box === undefined)
            box = $('<div class="alert alert-info"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
                .alert()
                .appendTo('#messageArea');
        if (rich) {
            return box.append($('<p/>').append(message));
        } else {
            return box.append($('<p/>')
                    .text(String(message)));
        }
    },
    showDebug: function(message) {
        $('<div class="alert alert-info"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
            .append($('<p/>')
                .text(String(message)))
            .alert()
            .appendTo('#messageArea');
    }
}

});
