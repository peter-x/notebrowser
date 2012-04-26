$(function() {
var noteBrowser;
var dbInterface;

function NoteBrowser() {
    this.currentNoteID = new LiveValue(null);

    var lthis = this;
    window.setTimeout(function() {
        lthis._noteList = new NoteList();
        lthis._init();
    }, 10);
}
NoteBrowser.prototype._init = function() {
    var lthis = this;
    function checkHash() {
        var hash = document.location.hash;
        if (hash.length <= 1)
            return;
        if ('#' + lthis._currentNoteId == hash)
            return; /* TODO what about note titles? */
        /* TODO change the hash back if the note was not found? */
        lthis._showNote(hash.substr(1));
    }

    $(window).on('hashchange', checkHash);
    dbInterface.on('ready', checkHash);

    $('#newNoteButton').click(function() {
        var n = new Note();
        n.setText("# New Note\n");
        n.save(function(err, note) {
            if (err) {
                lthis.showError(err);
                return;
            }
            /* TODO ask the previous NoteViewer to remove itself */
            var v = new NoteViewer(note);
            v.show(true);
            lthis.currentNoteID.set(note.getID());
        });

    });
}
NoteBrowser.prototype.showError = function(message) {
    $('<div class="alert alert-error"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
        .append($('<p/>')
            .text(String(message)))
        .alert()
        .appendTo('#messageArea');
}
NoteBrowser.prototype._showNote = function(id) {
    var lthis = this;
    $('#noteArea').empty();
    /* TODO also try to show the note by name */
    Note.get(id, function(err, note) {
        if (err) {
            lthis.showError(err);
            return;
        }
        /* TODO ask the previous NoteViewer to remove itself */
        var viewer = new NoteViewer(note, lthis);
        viewer.show();
        lthis.currentNoteID.set(note.getID());
    });
}

/* TODO Try to use events for errors */
function NoteViewer(note) {
    this._note = note;

    this._editMode = false;

    this._container = null;
    this._buttonEdit = null;
    this._buttonSave = null;
    this._buttonCancel = null;
    this._textArea = null;
    this._viewArea = null;
}
NoteViewer.prototype.show = function(editMode) {
    var lthis = this;

    this._container = $('<div/>');
    /* TODO do we really want explicit save? */
    /* TODO is it safe to use "float: right" in bootstrap? */
    this._buttonEdit = $('<button class="btn" style="float: right;"><i class="icon-edit"/> Edit</button>')
        .click(function() { lthis._toEditMode(); })
        .appendTo(this._container);
    this._buttonCancel = $('<button class="btn" style="float: right;">Cancel</button>')
        .click(function() { lthis._cancelChanges(); })
        .appendTo(this._container);
    this._buttonSave = $('<button class="btn btn-primary" style="float: right;">Save</button>')
        .click(function() { lthis._saveChanges(); })
        .appendTo(this._container);

    this._textArea = $('<textarea style="width: 100%; height: 800px; margin-top: 10px;"></textarea>')
        .appendTo(this._container);

    this._viewArea = $('<div/>')
        .appendTo(this._container);

    if (editMode) {
        this._toEditMode();
    } else {
        this._toViewMode();
    }

    $('#noteArea').empty();
    this._container.appendTo('#noteArea');
}
NoteViewer.prototype._toEditMode = function() {
    this._editMode = true;
    this._buttonEdit.hide();
    this._buttonSave.show();
    this._buttonCancel.show();
    this._viewArea
        .hide()
        .empty();
    this._textArea.text(this._note.getText());
    this._textArea.show();
    this._textArea.focus();
}
NoteViewer.prototype._toViewMode = function() {
    this._editMode = false;
    this._buttonEdit.show();
    this._buttonSave.hide();
    this._buttonCancel.hide();

    var text = this._note.getText();
    var c = new Showdown.converter();
    this._viewArea
        .empty()
        .append(c.makeHtml(text))
        .show();
    this._textArea.empty();
    this._textArea.hide();
}
NoteViewer.prototype._saveChanges = function() {
    /* TODO extract title */
    var text = this._textArea.val();

    var lthis = this;
    this._note.setText(this._textArea.val());
    this._note.save(function(err, val) {
        if (err) {
            noteBrowser.showError(err);
            return;
        } else {
            lthis._toViewMode();
        }
    });
}
NoteViewer.prototype._cancelChanges = function() {
    this._toViewMode();
}

function DBInterface() {
    this._db = null;

    var lthis = this;
    window.setTimeout(function() {
        lthis._init();
    }, 10);
}
DBInterface.prototype._init = function() {
    var lthis = this;
    new Pouch('idb://notebrowser', function(err, db) {
        if (err) {
            noteBrowser.showError("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        lthis._db = db;
        lthis._trigger('ready');
    });
}
DBInterface.prototype.getAllNoteTitles = function(callback) {
    if (!this._db) {
        callback("Not connected to database.");
        return;
    }

    var lthis = this;

    var queryFun = function(doc) { if (doc.type == 'note') emit(doc.title, null); };
    this._db.query(queryFun, null, function(err, res) {
        if (err) {
            callback("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        var notes = [];
        res.rows.forEach(function(row) {
            notes.push({id: row.id, title: row.key});
        });
        callback(null, notes);
    });
}
DBInterface.prototype.getNote = function(id, callback) {
    if (!this._db) {
        callback("Not connected to database.");
        return;
    }

    var lthis = this;

    this._db.get(id, function(err, doc) {
        if (err) {
            callback("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        callback(null, doc);
    });
}
DBInterface.prototype.saveNote = function(note, callback) {
    if (!this._db) {
        callback("Not connected to database.");
        return;
    }

    this._db.post(note, function(err, res) {
        if (err) {
            callback("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        note._id = res.id;
        note._rev = res.rev;
        /* TODO conflict */
        callback(null, note);
    });
}
addEvents(DBInterface, ['ready']);


function NoteList() {
    /* TODO search */

    var lthis = this;
    noteBrowser.currentNoteID.getLive(function(val) {
        lthis._setListHilight(val);
    });
    /* TODO use change listener */
    dbInterface.on('ready', function() { lthis.update(); });
}
NoteList.prototype.update = function() {
    var lthis = this;

    $('#noteListStart ~ li').remove();
    /* TODO Add some "in progress" widget? Only remove shortly before update? */
    dbInterface.getAllNoteTitles(function(err, notes) {
        /* TODO handle error */
        notes.forEach(function(note) {
            lthis._getNoteLink(note.id, note.title).appendTo('#noteList');
        });
        lthis._setListHilight(noteBrowser.currentNoteID.get());
    });
}
NoteList.prototype._getNoteLink = function(id, title) {
    return $('<li/>')
        .append($('<a/>', {href: '#' + encodeURIComponent(id)})
                .text(title));
}
NoteList.prototype._setListHilight = function(id) {
    $('#noteListStart ~ li').removeClass('active');
    var link = $('#noteListStart ~ li a[href="#' + encodeURIComponent(id) + '"]');
    if (link) {
        link.parents('#noteListStart ~ li').addClass('active');
    }
}


/**
 * Database model. New Notes are not yet stored in the database.
 * Setters are only consistent with their getter after a successful save.
 * Title is automatically extracted from text upon save.
 */
function Note() {
    this._id = null;
    this._rev = null;
    this._title = null;
    this._text = null;

    this._titleToSave = null;
    this._textToSave = null;
}
Note.prototype.getID = function() {
    return this._id;
}
Note.prototype.setTitle = function(title) {
    this._titleToSave = title;
}
Note.prototype.getTitle = function() {
    return this._title;
}
Note.prototype.setText = function(text) {
    this._textToSave = text;
}
Note.prototype.getText = function() {
    return this._text;
}
Note.prototype.save = function(callback) {
    var text = this._textToSave === null ? this._text : this._textToSave;
    var title = Note._getTitleFromText(text);
    var doc = {
        '_id': this._id,
        '_rev': this._rev,
        'type': 'note',
        'title': title,
        'text': text
    }
    var lthis = this;
    dbInterface.saveNote(doc, function(err, note) {
        if (err) {
            if (callback !== undefined) callback(err);
        } else {
            /* TODO this could go wrong if we have saved again in the meantime
             * it would be better to accept only increasing revisions */
            lthis._id = note._id;
            lthis._rev = note._rev;
            lthis._text = note.text;
            lthis._textToSave = null;
            lthis._title = note.title;
            lthis._titleToSave = null;
            if (callback !== undefined) callback(null, lthis);
            lthis._trigger('changed');
        }
    });
}
/* static */
Note._getTitleFromText = function(text) {
    /* TODO improve this */
    var m = text.match(/^#(.+)\n/);
    if (m) {
        return m[1].trim();
    } else {
        return "Note";
    }
}
Note.get = function(id, callback) {
    dbInterface.getNote(id, function(err, note) {
        if (err) {
            callback(err);
            return;
        }
        var n = new Note();
        n._id = note._id;
        n._rev = note._rev;
        n._text = note.text;
        n._title = note.title;
        callback(null, n);
    });
}
addEvents(Note, ['changed']);

noteBrowser = new NoteBrowser();
dbInterface = new DBInterface();

});
