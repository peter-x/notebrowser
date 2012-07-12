/* TODO actually we do not need a top-level module like this */
define(['jquery', 'bootstrap',
        'ui/noteviewer', 'ui/logger',
        'util/livevalue', 'util/events',
        'db/local', 'db/objectcache', 'db/syncer',
        'db/objects/note', 'db/objects/synctarget'
        ],
        function($, bootstrap,
                 NoteViewer, logger,
                 LiveValue, Events,
                 db, objectCache, synchronize,
                 Note, SyncTarget) {
"use strict";

function NoteBrowser() {
    this.currentNoteID = new LiveValue(null);

    this._noteViewer = new NoteViewer();

    var lthis = this;

    db.on('init error', function(error) {
        logger.showError(error);
    });
    objectCache.on('ready', function() {
        $.each(objectCache.getAllSyncTargets(), function(id, t) {
            lthis._updateSyncTargetButton(t);
        });

        lthis._init();
    });
    objectCache.on('note changed', function(note, oldnote) {
        var tasource = $('#searchInput').data('typeahead').source;
        if (oldnote)
            tasource.splice(tasource.indexOf(oldnote.getTitle()), 1);
        tasource.push(note.getTitle());
    });
    objectCache.on('synctarget changed', function(target, oldtarget) {
        lthis._updateSyncTargetButton(target);
    });
}
NoteBrowser.prototype._init = function() {
    var lthis = this;
    function checkHash() {
        var hash = document.location.hash;
        if (hash.length <= 1)
            return;
        hash = hash.substr(1);
        if (lthis.currentNoteID.get() === hash)
            return;
        var note = objectCache.getNoteByID(hash) || objectCache.getFirstNoteByTitle(hash);
        if (note === undefined) {
            var curID = lthis.currentNoteID.get();
            document.location.hash = curID === null ? '' : '#' + curID;
            logger.showError("Note " + hash + " not found.");
            return false;
        }
        lthis.currentNoteID.set(note.getID());
        lthis._noteViewer.showNote(note);
        $('#noteNavigation').addClass('hidden-phone');
        $('#noteArea').show();
    }

    $(window).on('hashchange', checkHash);
    checkHash();

    $('#newNoteButton').click(function() {
        Note.create('# New Note\n')
            .fail(function(err) { logger.showError(err); })
            .done(function(note) {
                lthis._noteViewer.showEditNote(note);
                lthis.currentNoteID.set(note.getID());
                document.location.hash = '#' + note.getID();
                $('#noteNavigation').addClass('hidden-phone');
                $('#noteArea').show();
            });
    });
    /* TODO problem if two notes have the same title */
    $('#searchInput').typeahead({
        source: $.map(objectCache.getAllNotes(), function(note) { return note.getTitle(); }),
        updater: function(title) {
            document.location.hash = '#' + title;
            return title;
        }
    });
    $('#newSyncButton').click(function() {
        /* TODO improve this */
        var name = prompt("Name");
        if (!name) return;
        var url = prompt("URL");
        if (!url) return;

        SyncTarget.create(name, url)
            .fail(function(err) { logger.showError(err); });
    });
    $('#showNoteNavigationButton').click(function() {
        lthis.currentNoteID.set(null);
        lthis._noteViewer.closeNote();
        $('#noteNavigation').removeClass('hidden-phone');
        $('#noteArea').hide();
    });
}
NoteBrowser.prototype._updateSyncTargetButton = function(target) {
    target = target.copy();
    $('#synctargetbutton_' + target.getID(), '#syncTargetButtons').remove();
    $('<li id="synctargetbutton_' + target.getID() + '"/>')
        .append($('<a href="#"/>')
            .text(target.getName())
            .click(function(e) {
                synchronize(target)
                    .done(function() {
                        logger.showInfo("Synchronized with " + target.getName());
                    })
                    .fail(function(e) {
                        logger.showError("Error synchronizing with " + target.getName() + ": " + e);
                    });
                e.preventDefault();
                return true;
            }))
        .appendTo('#syncTargetButtons');
}

var noteBrowser = new NoteBrowser();

return noteBrowser;
});
