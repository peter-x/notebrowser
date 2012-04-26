function NoteBrowser() {
    this._dbInterface = new DBInterface(this);
    this._noteList = new NoteList(this._dbInterface, this);
    this._init();
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
    this._dbInterface.on('ready', checkHash);

    $('#newNoteButton').click(function() {
        var n = Note.fromIncompleteDbObject({title: "New Note"}, lthis._dbInterface);
        n.setTextAndSave("", function(err, note) {
            if (err) {
                lthis.showError(err);
                return;
            } else {
                var v = new NoteViewer(note, lthis);
                v.show(true);
                var id = note.getID();
                /* TODO make this a live value and do not use the event */
                lthis._currentNoteId = id;
                lthis._noteList.update();
                lthis._trigger("activeNoteChanged", id);
            }
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
    this._dbInterface.getNote(id, function(err, note) {
        if (err) {
            lthis.showError(err);
            return;
        }
        var viewer = new NoteViewer(note, lthis);
        viewer.show();
        lthis._currentNoteId = note.getID();
        lthis._trigger("activeNoteChanged", id);
    });
}
addEvents(NoteBrowser, ["activeNoteChanged"]);

/* TODO it is not nice that NoteViewer needs noteBrowser,
 * try to use events for errors */
function NoteViewer(note, noteBrowser) {
    this._note = note;

    this._noteBrowser = noteBrowser;

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
    this._note.setTextAndSave(this._textArea.val(), function(err, val) {
        if (err) {
            lthis._noteBrowser.showError(err);
            return;
        } else {
            lthis._toViewMode();
        }
    });
}
NoteViewer.prototype._cancelChanges = function() {
    this._toViewMode();
}

function DBInterface(noteBrowser) {
    this._noteBrowser = noteBrowser;
    this._db = null;

    this._init();
}
DBInterface.prototype._init = function() {
    var lthis = this;
    new Pouch('idb://notebrowser', function(err, db) {
        if (err) {
            lthis._noteBrowser.showError("Database error: " + err.error + " (" + err.reason + ")");
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

    var queryFun = function(doc) { emit(doc.title, null); };
    this._db.query(queryFun, null, function(err, res) {
        if (err) {
            callback("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        var notes = [];
        res.rows.forEach(function(row) {
            notes.push(Note.fromIncompleteDbObject({_id: row.id, title: row.key}, lthis));
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

    var queryFun = function(doc) { emit(doc.title, null); };
    this._db.get(id, function(err, doc) {
        if (err) {
            callback("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        callback(null, Note.fromDbObject(doc, lthis));
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


function NoteList(dbInterface, noteBrowser) {
    /* TODO search */
    //this._noteList = $('#noteList');
    //this._noteListStart = $('#noteListStart');

    var lthis = this;
    this._db = dbInterface;
    this._noteBrowser = noteBrowser;
    this._activeNote = null;

    this._noteBrowser.on('activeNoteChanged', function(id) { lthis._setActiveNote(id); });
    this._db.on('ready', function() { lthis.update(); });
}
NoteList.prototype.update = function() {
    var lthis = this;

    $('#noteListStart ~ li').remove();
    /* TODO Add some "in progress" widget? Only remove shortly before update? */
    this._db.getAllNoteTitles(function(err, notes) {
        /* TODO handle error */
        notes.forEach(function(note) {
            lthis._getNoteWidget(note).appendTo('#noteList');
        });
    });
}
NoteList.prototype._getNoteWidget = function(note) {
    return $('<li/>')
        .append($('<a/>', {href: '#' + encodeURIComponent(note.getID())})
                .text(note.getTitle()));
}
NoteList.prototype._setActiveNote = function(id) {
    this._activeNote = id;
    $('#noteListStart ~ li').removeClass('active');
    var link = $('#noteListStart ~ li a[href="#' + encodeURIComponent(id) + '"]');
    if (link) {
        link.parents('#noteListStart ~ li').addClass('active');
    }
}


/* TODO decide if the note class should be the actual db interface */
function Note(db) {
    this._db = db;
    this._dbObj = null;
    this._complete = false;
}
Note.prototype.getID = function() {
    return this._dbObj._id;
}
Note.prototype.setTitle = function(title) {
    this._dbObj.title = title;
}
Note.prototype.getTitle = function() {
    return this._dbObj.title;
}
Note.prototype.setText = function(text) {
    this._dbObj.text = text;
}
Note.prototype.setTextAndSave = function(text, callback) {
    var doc = {
        '_id': this._dbObj._id,
        '_rev': this._dbObj._rev,
        title: this._dbObj.title,
        text: text
    }
    var lthis = this;
    this._db.saveNote(doc, function(err, d) {
        if (err) {
            callback(err);
            return;
        } else {
            lthis._dbObj._id = d._id;
            lthis._dbObj._rev = d._rev;
            lthis._dbObj.text = text;
            callback(null, lthis);
        }
    });
}
Note.prototype.getText = function() {
    return this._dbObj.text;
}
/* static */
Note.fromDbObject = function(obj, db) {
    var n = new Note(db);
    n._dbObj = obj; /* XXX copy? */
    n._complete = true;
    return n;
}
Note.fromIncompleteDbObject = function(obj, db) {
    /* obj should at least contain id and title */
    var n = new Note(db);
    n._dbObj = obj; /* XXX copy? */
    n._complete = false;
    return n;
}

/* TODO avoid namespace cluttering */

$(function() {
    window.noteBrowser = new NoteBrowser();
});
