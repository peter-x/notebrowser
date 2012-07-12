define(['jquery', 'db/objectcache', 'ui/notebrowser'], function($, objectCache, noteBrowser) {
"use strict";

function NoteList() {
    /* TODO search */

    this._changeListener = null;
    this._sortStyle = 'tag'; /* XXX we should extract that from the html */

    var lthis = this;

    this._installChangeListener();
    noteBrowser.currentNoteID.getLive(function(val) {
        lthis._setListHilight(val);
    });
    objectCache.on('ready', function() { lthis.update(); });
    $('#sortByTitle').click(function() {
        lthis._sortStyle = 'title';
        $('li', $('#sortByTitle').closest('ul')).removeClass('active');
        $('#sortByTitle').closest('li').addClass('active');
        lthis.update();
        return false;
    });
    $('#sortByDate').click(function() {
        lthis._sortStyle = 'date';
        $('li', $('#sortByDate').closest('ul')).removeClass('active');
        $('#sortByDate').closest('li').addClass('active');
        lthis.update();
        return false;
    });
    $('#sortByTags').click(function() {
        lthis._sortStyle = 'tag';
        $('li', $('#sortByTags').closest('ul')).removeClass('active');
        $('#sortByTags').closest('li').addClass('active');
        lthis.update();
        return false;
    });
}
NoteList.prototype.destroy = function() {
    if (lthis._changeListener !== null)
        objectCache.off('note changed', lthis._changeListener);
    lthis._changeListener = null;
}
NoteList.prototype.update = function() {
    var lthis = this;

    $('#noteList li').remove();
    $.each(objectCache.getAllNotes(), function(id, note) {
        lthis._insertNote(note);
    });
    this._setListHilight(noteBrowser.currentNoteID.get());
}
NoteList.prototype._getNoteLink = function(note, sortKey) {
    return $('<li id="noteList_' + note.getID() + '"/>')
        .data('sortKey', sortKey)
        .append($('<a/>', {href: '#' + encodeURIComponent(note.getID())})
                .text(note.getTitle()));
}
NoteList.prototype._setListHilight = function(id) {
    $('#noteList li').removeClass('active');
    /* XXX how to escape? */
    if (id !== null)
        $('#noteList_' + id).addClass('active');
}
NoteList.prototype._installChangeListener = function() {
    var lthis = this;
    if (lthis._changeListener === null) {
        lthis._changeListener = objectCache.on('note changed', function(note, oldNote) {
            if (oldNote) lthis._removeNote(oldNote);
            lthis._insertNote(note);

            var hilightID = noteBrowser.currentNoteID.get();
            if (hilightID === note.getID())
                lthis._setListHilight(hilightID);
        });
    }
}
NoteList.prototype._dateToDayStr = function(date) {
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    if (isNaN(year)) {
        return 'Unknown';
    } else {
        return year + '-' + (month < 10 ? '0' + month : month) +
                      '-' + (day < 10 ? '0' + day : day);
    }
}
NoteList.prototype._removeNote = function(note) {
    /* XXX how to escape? */
    $('#noteList_' + note.getID()).remove();
}
NoteList.prototype._findElementPosition = function(key, list, reversed) {
    var a = 0, b = list.length;
    while (b - a > 1) {
        var m = Math.floor((a + b) / 2);
        var keyThere = $(list[m]).data('sortKey');
        if (key === keyThere)
            return [0, m];
        var cmp = (key < keyThere);
        if (reversed) cmp = !cmp;

        if (cmp) {
            b = m;
        } else {
            a = m;
        }
    }
    if (list.length === 0) {
        return [-2, 0];
    } else {
        var keyThere = $(list[a]).data('sortKey');
        if (key === keyThere)
            return [0, a];
        var cmp = key < keyThere;
        if (reversed) cmp = !cmp;
        if (cmp) {
            return [-1, a];
        } else {
            return [1, a];
        }
    }
}
NoteList.prototype._insertElement = function(element, listParent, list, reversed) {
    var res = this._findElementPosition(element.data('sortKey'), list, reversed);
    if (res[0] === -2) {
        element.prependTo(listParent);
        return 0;
    } else if (res[0] === -1 || res[0] === 0) {
        element.insertBefore($(list[res[1]]));
        return -1;
    } else {
        element.insertAfter($(list[res[1]]));
        return 1;
    }
}
NoteList.prototype._insertNote = function(note) {
    var lthis = this;
    if (this._sortStyle === 'title') {
        var l = this._getNoteLink(note, note.getTitle());
        this._insertElement(l, $('#noteList'), $('li', '#noteList'));
    } else if (this._sortStyle === 'tag') {
        /* XXX actually we should also include at least one note of each
         * unreachable cycle */
        var tagExists = function(tag) {
            return objectCache.getNoteByID(tag) !== undefined;
        }
        if (note.getTags().some(tagExists)) return;
        var l = this._getNoteLink(note, note.getTitle());
        this._insertElement(l, $('#noteList'), $('li', '#noteList'));
    } else {
        var date = this._dateToDayStr(note.getDate());
        var headers = $('li[class=nav-header]', '#noteList');

        var l = this._getNoteLink(note, note.getTitle());
        var res = this._findElementPosition(date, headers, true);
        var a = res[1];

        if (res[0] === 0) {
            var notes = $(headers[a]).nextUntil('li[class=nav-header]');
            if (true || notes.length === 0) {
                l.insertAfter(headers[a]);
            } else {
                this._insertElement(l, null, notes);
            }
        } else {
            var header = $('<li class="nav-header"/>')
                .data('sortKey', date)
                .text(date);
            if (res[0] === -2) {
                header.appendTo('#noteList');
            } else if (res[0] === -1) {
                header.insertBefore(headers[a]);
            } else {
                if (a === headers.length - 1) {
                    header.appendTo('#noteList');
                } else {
                    header.insertBefore(headers[a + 1]);
                }
            }
            l.insertAfter(header);
        }
    }


    /* TODO find some nice effect */
    $('a', l)
        .css('color', 'white')
        .delay(500)
        .queue(function(next) {
            $(this).css('color', '');
            next();
        });
}

return new NoteList();

});
