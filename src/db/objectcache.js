/* circular dependency for note and synctarget */
define(['jquery', 'util/events'], function($, Events) {
"use strict";

function ObjectCache() {
    this._notesByID = null;
    this._notesByTitle = null;
    this._notesByTag = null;
    this._notesBySyncTarget = null;
    this._syncTargetsByID = null;
}
ObjectCache.prototype.initialize = function(notes, syncTargets) {
    var lthis = this;

    this._notesByID = {};
    this._notesByTitle = {};
    this._notesByTag = {};
    this._notesBySyncTarget = {};
    this._syncTargetsByID = {};
    notes.forEach(function(note) {
        note.setImmutable();
        lthis._insertNote(note);
    });
    syncTargets.forEach(function(syncTarget) {
        syncTarget.setImmutable();
        lthis._syncTargetsByID[syncTarget.getID()] = syncTarget;
    });

    this._trigger('ready');
}
/* called from db */
ObjectCache.prototype.noteChanged = function(note) {
    var oldNote = this.getNoteByID(note.getID());

    this._removeNote(note.getID());
    note.setImmutable();
    this._insertNote(note);
    this._trigger('note changed', note, oldNote);
}
/* called from db */
ObjectCache.prototype.syncTargetChanged = function(syncTarget) {
    syncTarget.setImmutable();
    this._syncTargetsByID[syncTarget._id] = syncTarget;
    this._trigger('synctarget changed', syncTarget);
}
ObjectCache.prototype._insertNote = function(note) {
    var lthis = this;
    var id = note.getID();
    var title = note.getTitle();

    this._notesByID[id] = note;
    if (!(title in this._notesByTitle)) {
        this._notesByTitle[title] = {};
    }
    this._notesByTitle[title][id] = note;

    note.getTags().forEach(function(tag) {
        if (!(tag in lthis._notesByTag))
            lthis._notesByTag[tag] = {};
        lthis._notesByTag[tag][id] = note;
    });

    for (var targetID in note.getSyncTargets()) {
        if (!(targetID in lthis._notesBySyncTarget))
            lthis._notesBySyncTarget[targetID] = {};
        lthis._notesBySyncTarget[targetID][id] = note;
    }
}
ObjectCache.prototype._removeNote = function(id) {
    var lthis = this;
    if (!(id in this._notesByID)) return;

    var note = this._notesByID[id];

    note.getTags().forEach(function(tag) {
        if (lthis._notesByTag[tag] !== undefined)
            delete lthis._notesByTag[tag][id];
    });
    for (var targetID in note.getSyncTargets()) {
        if (lthis._notesBySyncTarget[targetID] !== undefined)
            delete lthis._notesBySyncTarget[targetID][id];
    }
    var title = note.getTitle();
    delete this._notesByTitle[title][id];
    delete this._notesByID[id];

    if (this.getFirstNoteByTitle(title) === undefined) {
        delete this._notesByTitle[title];
    }
}
ObjectCache.prototype.getNoteByID = function(id) {
    return this._notesByID[id];
}
ObjectCache.prototype.getFirstNoteByTitle = function(title) {
    var notes = this._notesByTitle[title];
    if (notes === undefined) return undefined;
    for (var id in notes) {
        return this._notesByID[id];
    }
    return undefined;
}
ObjectCache.prototype.getNoteByTitle = function(title) {
    return this._notesByTitle[title] || {};
}
ObjectCache.prototype.getNotesByTag = function(tag) {
    return this._notesByTag[tag] || {};
}
ObjectCache.prototype.getNotesBySyncTarget = function(syncTargetID) {
    return this._notesBySyncTarget[syncTargetID] || {};
}
ObjectCache.prototype.getAllNotes = function() {
    return this._notesByID; /* XXX copy? */
}
ObjectCache.prototype.getAllSyncTargets = function() {
    return this._syncTargetsByID; /* XXX copy? */
}
Events(ObjectCache, ['ready', 'note changed', 'synctarget changed']);

return new ObjectCache();

});
