define(['jquery', 'db/objectcache', 'ui/notebrowser'], function($, objectCache, noteBrowser) {
"use strict";

function NoteList() {
    /* TODO search */

    this._changeListener = null;
    this._sortStyle = 'tag'; /* XXX we should extract that from the html */

    this._currentHilight = null;

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
NoteList.prototype._getNoteLink = function(note, sortKey, treeNode) {
    var lthis = this;
    var li = $('<li class="noteList_' + note.getID() + '"/>')
        .data('sortKey', sortKey);
    var link = $('<a/>', {href: '#' + encodeURIComponent(note.getID())})
        .text(note.getTitle())
        .appendTo(li);
    if (treeNode) {
        $('<span class="treeicon"/>')
            .click(function() {
                /* we have to determine it manually since
                 * this node can get cloned */
                var li = $(this).closest('li');
                li.toggleClass('open');
                lthis._treeNodeToggled(li, note.getID());
                return false;
            })
            .prependTo(link);
    }
    return li;
}
NoteList.prototype._setListHilight = function(id) {
    this._currentHilight = id;
    $('#noteList li').removeClass('active');
    /* XXX how to escape? */
    if (id !== null)
        $('.noteList_' + id).addClass('active');
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
    $('.noteList_' + note.getID()).remove();
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
        /* If this note has no tags, insert it at the root.
         * Otherwise, insert it below each opened display of its tags
         */
        /* XXX this results in tag-cycles to be invisible.
         * include at least one note of each unreachable cycle */

        var tags = note.getTags();
        var tagExists = function(tag) {
            return objectCache.getNoteByID(tag) !== undefined;
        }

        var parents = $();
        if (tags.some(tagExists)) {
            tags.forEach(function(tag) {
                /* XXX how to escape? */
                parents = parents.add('.noteList_' + tag + '.open > ul');
            });
        } else {
            parents = $('#noteList');
        }

        var l = this._getNoteLink(note, note.getTitle(), true);
        parents.each(function(i, par) {
            lthis._insertElement(l.clone(true), par, $(par).children('li'));
        });
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


    if (note.getID() === this._currentHilight)
        this._setListHilight(this._currentHilight);
    
    /* TODO find some nice effect */
    /*
    $('a', l)
        .css('color', 'white')
        .delay(500)
        .queue(function(next) {
            $(this).css('color', '');
            next();
        });
    */
}
NoteList.prototype._treeNodeToggled = function(node, noteID) {
    var lthis = this;
    if (node.hasClass('open')) {
        var ul = $('<ul class="nav nav-list"/>').appendTo(node);
        $.each(objectCache.getNotesByTag(noteID), function(id, note) {
            var l = lthis._getNoteLink(note, note.getTitle(), true);
            lthis._insertElement(l, ul, ul.children('li'));
        });
        if (this._currentHilight !== null)
            this._setListHilight(this._currentHilight);
    
    } else {
        node.children('ul').remove();
    }
}

return new NoteList();

});
