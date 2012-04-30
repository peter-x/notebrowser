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
        if ('#' + lthis._currentNoteId === hash)
            return; /* TODO what about note titles? */
        /* TODO change the hash back if the note was not found? */
        lthis._showNote(hash.substr(1));
    }

    $(window).on('hashchange', checkHash);
    dbInterface.on('ready', checkHash);

    $('#newNoteButton').click(function() {
        Note.create({text: '# New Note\n'})
            .fail(function(err) { lthis.showError(err); })
            .done(function(note) {
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
    Note.get(id)
        .done(function(note) {
            /* TODO ask the previous NoteViewer to remove itself */
            var viewer = new NoteViewer(note);
            viewer.show();
            lthis.currentNoteID.set(note.getID());
        })
        .fail(function(err) { lthis.showError(err); });
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
    var lthis = this;
    /* XXX progress indicator */
    this._note.getText()
        .done(function(text) {
            lthis._editMode = true;
            lthis._buttonEdit.hide();
            lthis._buttonSave.show();
            lthis._buttonCancel.show();
            lthis._viewArea
                .hide()
                .empty();
            lthis._textArea.text(text);
            lthis._textArea.show();
            lthis._textArea.focus();
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });
}
NoteViewer.prototype._toViewMode = function() {
    var lthis = this;
    /* XXX progress indicator */
    this._note.getText()
        .done(function(text) {
            lthis._editMode = false;
            lthis._buttonEdit.show();
            lthis._buttonSave.hide();
            lthis._buttonCancel.hide();

            var c = new Showdown.converter();
            lthis._viewArea
                .empty()
                .append(c.makeHtml(text))
                .show();
            lthis._textArea.empty();
            lthis._textArea.hide();
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });

}
NoteViewer.prototype._saveChanges = function() {
    var text = this._textArea.val();

    var lthis = this;
    this._note.save({text: this._textArea.val()})
        .done(function(val) {
            lthis._toViewMode();
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });
}
NoteViewer.prototype._cancelChanges = function() {
    this._toViewMode();
}

function DBInterface() {
    this._db = null;
    this._backendType = 'couch'; /* or pouch */
    this._backendUrl = 'http://localhost:5984';

    var lthis = this;
    window.setTimeout(function() {
        if (lthis._backendType === 'couch') {
            lthis._initCouch();
        } else {
            lthis._initPouch();
        }
    }, 10);
}
DBInterface.prototype._initPouch = function() {
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
DBInterface.prototype._initCouch = function() {
    var lthis = this;
    $.couch.urlPrefix = this._backendUrl;
    var db = $.couch.db('notebrowser');
    db.create({
        success: function(data) {
            lthis._db = db;
            lthis._trigger('ready');
        },
        error: function(err) {
            /* Database already exists? Ignore the error. */
            lthis._db = db;
            lthis._trigger('ready');
        }
    });
}
DBInterface.prototype.getAllNoteTitles = function() {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;

    var d = $.Deferred();
    if (this._backendType === 'couch') {
        this._db.view('default/notesByTitle', {
            success: function(res) {
                var notes = [];
                res.rows.forEach(function(row) {
                    notes.push(Note.fromDBObject(row.doc));
                });
                d.resolve(notes);
            },
            error: function(err) {
                d.reject("Database error: " + err.error + " (" + err.reason + ")");
            },
            reduce: false,
            include_docs: true
        });
    } else {
        var queryFun = function(doc) { if (doc.type === 'note') emit(doc.title, null); };
        this._db.query(queryFun, null, function(err, res) {
            if (err) {
                d.reject("Database error: " + err.error + " (" + err.reason + ")");
                return;
            }
            var notes = [];
            res.rows.forEach(function(row) {
                notes.push({id: row.id, title: row.key});
            });
            d.resolve(notes);
        });
    }
    return d.promise();
}
DBInterface.prototype._getDoc = function(id) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;

    var d = $.Deferred();
    if (this._backendType === 'couch') {
        this._db.openDoc(id, {
            success: function(doc) { d.resolve(doc); },
            error: function(err) { d.reject("Database error: " + err.error + " (" + err.reason + ")"); }
        });
    } else {
        this._db.get(id, function(err, doc) {
            if (err) {
                d.reject("Database error: " + err.error + " (" + err.reason + ")");
            } else {
                d.resolve(doc);
            }
        });
    }
    return d.promise();
}
DBInterface.prototype.getNote = function(id) {
    /* XXX load current revision at the same time? */
    return this._getDoc(id);
}
DBInterface.prototype.getNoteRevision = function(id) {
    return this._getDoc(id);
}
DBInterface.prototype.getRevisionParents = function(revisionIDs) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;

    var d = $.Deferred();
    if (this._backendType === 'couch') {
        this._db.view('default/parentRevision', {
            success: function(res) {
                var parents = [];
                res.rows.forEach(function(row) {
                    parents.push(row.value);
                });
                d.resolve(parents);
            },
            error: function(err) {
                d.reject("Database error: " + err.error + " (" + err.reason + ")");
            },
            reduce: false,
            keys: revisionIDs
        });
    } else {
        /* TODO */
    }
    return d.promise();

}
DBInterface.prototype.saveDoc = function(doc) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    if (this._backendType === 'couch') {
        this._db.saveDoc(doc, {
            success: function(res) {
                doc._id = res.id;
                doc._rev = res.rev;
                d.resolve(doc);
            },
            error: function(err) {
                if (err == '409') {
                    /* conflict */
                    d.reject(err, true);
                } else {
                    d.reject(err);
                }
            }
        });
    } else {
        this._db.post(note, function(err, res) {
            if (err) {
                d.reject("Database error: " + err.error + " (" + err.reason + ")");
            } else {
                doc._id = res.id;
                doc._rev = res.rev;
                /* TODO conflict */
                d.resolve(doc);
            }
        });
    }
    return d.promise();
}
addEvents(DBInterface, ['ready']);


function NoteList() {
    /* TODO search */

    var lthis = this;
    noteBrowser.currentNoteID.getLive(function(val) {
        lthis._setListHilight(val);
    });
    /* TODO use database changes feed */
    dbInterface.on('ready', function() { lthis.update(); });
}
NoteList.prototype.update = function() {
    var lthis = this;

    $('#noteListStart ~ li').remove();
    /* TODO Add some "in progress" widget? Only remove shortly before update? */
    dbInterface.getAllNoteTitles()
        .done(function(notes) {
            notes.forEach(function(note) {
                lthis._getNoteLink(note.getID(), note.getTitle()).appendTo('#noteList');
            });
            lthis._setListHilight(noteBrowser.currentNoteID.get());
        })
        .fail(function(err) {
            noteBrowser.showError(err);
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


function Note() {
    this._id = null;
    this._rev = null;
    this._title = null;
    this._headRev = null;

    this._headRevObj = null;
}
Note.prototype.getID = function() {
    return this._id;
}
Note.prototype.getTitle = function() {
    return this._title;
}
Note.prototype.getText = function() {
    var lthis = this;
    if (this._headRevObj !== null) {
        var d = $.Deferred();
        d.resolve(lthis._headRevObj.getText());
        return d.promise();
    } else {
        return NoteRevision.get(lthis._headRev)
            .pipe(function(h) { return (lthis._headRevObj = h).getText(); },
                  function(err) { return err; });
    }
}
Note.prototype._save = function() {
    var lthis = this;
    var d = $.Deferred();

    this.getText()
        .fail(function(err) { d.reject(err); })
        .done(function(text) {
            var title = Note._getTitleFromText(text);
            var doc = {
                'type': 'note',
                'title': title,
                'headRev': lthis._headRev
            };
            if (lthis._id !== null && lthis._rev !== null) {
                doc._id = lthis._id;
                doc._rev = lthis._rev;
            }
            dbInterface.saveDoc(doc)
                /* XXX detect conflicts */
                .fail(function(err, conflict) { d.reject(err, conflict); })
                .done(function(doc) {
                    /* TODO could this go wrong if two parallel save operations from this
                     * client end up the other way round? */
                    lthis._id = doc._id;
                    lthis._rev = doc._rev;
                    lthis._title = doc.title;
                    if (lthis._headRev !== doc.headRev)
                        lthis._headRevObj = null;
                    lthis._headRev = doc.headRev;
                    d.resolve(lthis);
                });
        });
    return d.promise();
}
Note.prototype.save = function(data) {
    var lthis = this;
    var d = $.Deferred();
    var nrSave = NoteRevision.createNew(data.text, data.author || null, data.date || (new Date()),
                        data.revType || "edit", data.parents || [this._headRev]);
    nrSave.fail(function(err) { d.reject("Error saving revision: " + err); });
    nrSave.done(function(nr) {
        lthis._updateToRevision(nr._id, nr)
            .fail(function(err) { d.reject("Error saving note: " + err); })
            .done(function() { d.resolve(lthis); });
    });
    return d.promise();
}
Note.prototype._updateToRevision = function(rev, revObj) {
    var lthis = this;
    var d = $.Deferred();
    /* XXX we shold not store this in the object until saved */
    lthis._headRev = rev;
    lthis._headRevObj = revObj;
    lthis._save()
        .done(function() { d.resolve(lthis); })
        .fail(function(err, conflict) {
            if (!conflict) {
                d.reject("Error saving note: " + err);
                return;
            }
            Note.get(lthis._id)
                .fail(function(err) { d.reject("Error saving note: " + err); })
                .done(function(currentNote) {
                    currentNote.mergeWith(lthis, false)
                        .fail(function(err) { d.reject("Error saving note (in conflict resolution): " + err); })
                        .done(function() {
                            lthis._rev = currentNote._rev;
                            lthis._title = currentNote._title;
                            lthis._headRev = currentNote._headRev;
                            lthis._headRevObj = currentNote._headRevObj;
                            d.resolve(lthis);
                        });
                });
        });
    return d.promise();
}
Note.prototype.mergeWith = function(otherNote, deleteOther) {
    var lthis = this;
    var d = $.Deferred();
    lthis.getText()
        .fail(function(err) { d.reject(err); })
        .done(function() {
            otherNote.getText()
                .fail(function(err) { d.reject(err); })
                .done(function() {
                    lthis._headRevObj.createMergedRevision(otherNote._headRevObj)
                        .fail(function(err) { d.reject(err); })
                        .done(function(newRevObj) {
                            lthis._updateToRevision(newRevObj.getID(), newRevObj)
                                .fail(function(err) { d.reject(err); })
                                .done(function() { d.resolve(lthis); });
                        });
                });
        });
    return d.promise();
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
Note.get = function(id) {
    return dbInterface.getNote(id)
        .pipe(function(doc) { return Note.fromDBObject(doc); },
              function(err) { return err; });
}
Note.fromDBObject = function(doc) {
    var n = new Note();
    n._id = doc._id;
    n._rev = doc._rev;
    n._title = doc.title;
    n._headRev = doc.headRev;
    return n;
}
Note.create = function(data) {
    var n = new Note();
    data.parents = [];
    data.revType = "create";
    return n.save(data);
}

function NoteRevision() {
    this._id = null;
    this._rev = null;
    this._date = null;
    this._author = null;
    this._revType = null; /* "edit", "create", "auto merge", "manual merge" */
    this._parents = null;
    this._text = null;
}
NoteRevision.prototype.getID = function() {
    return this._id;
}
NoteRevision.prototype.getText = function() {
    return this._text;
}
NoteRevision.prototype.getParents = function() {
    return this._parents; /* TODO copy? */
}
/* TODO revType, date, author? */
NoteRevision.prototype.createMergedRevision = function(otherRev) {
    var lthis = this;
    var d = $.Deferred();
    this._findCommonAncestor(otherRev)
        .fail(function(err) { d.reject(err); })
        .done(function(parentId) {
            NoteRevision.get(parentId)
                .fail(function(err) { d.reject(err); })
                .done(function(parentRev) {
                    var textA = lthis.getText();
                    var textB = otherRev.getText();
                    var textParent = parentRev.getText();
                    var m;
                    if (lthis.getID() < otherRev.getID()) {
                        /* order is important, XXX check if this suffices to
                         * create clean distributed merges */
                        m = new Merge(textParent, textA, textB);
                    } else {
                        m = new Merge(textParent, textB, textA);
                    }
                    textMerged = m.getMergedText();
                    NoteRevision.createNew(textMerged, null, new Date(), "auto merge",
                                          [lthis.getID(), otherRev.getID()])
                        .fail(function(err) { d.reject(err); })
                        .done(function(mergedRev) { d.resolve(mergedRev); });
                });
        });

    return d.promise();
}
NoteRevision.prototype._findCommonAncestor = function(otherRev) {
    /* first try it directly using the parent IDs we already have */
    var idA = this.getID();
    var idB = otherRev.getID();
    if (idA === idB)
        return $.Deferred().resolve(idA).promise();

    var pA = this.getParents();
    var pB = otherRev.getParents();
    if ($.inArray(idA, pB) >= 0)
        return $.Deferred().resolve(idA).promise();
    if ($.inArray(idB, pA) >= 0)
        return $.Deferred().resolve(idB).promise();

    for (var i = 0; i < pA.length; i ++)
        for (var j = 0; j < pB.length; j ++)
            if (pA[i] === pB[j])
                return $.Deferred().resolve(pA[i]).promise();

    /* now hand it over to the professionals */
    return FindCommonAncestor(this._id, otherRev.getID());
}
/* static */
NoteRevision._fromDBObject = function(doc) {
    var nr = new NoteRevision();
    nr._id = doc._id;
    nr._rev = doc._rev;
    nr._date = doc.date; /* XXX parse? */
    nr._author = doc.author;
    nr._revType = doc.revType;
    nr._parents = doc.parents;
    nr._text = doc.text;
    return nr;
}
NoteRevision.get = function get(id) {
    return dbInterface.getNoteRevision(id).pipe(NoteRevision._fromDBObject,
                    function(err) { return err; });
}
NoteRevision.createNew = function createNew(text, author, date, revType, parents) {
    var doc = {
        type: "noteRevision",
        date: date,
        author: author,
        revType: revType,
        parents: parents.sort(),
        text: text
    }
    if (parents.length != 0) {
        /* The revision graphs for two different notes should be separated.
         * If two new notes with identical content are created, the two
         * revisions will have the same id. To avoid this, let the server
         * choose an id in this case. */
        doc._id = 'rev-' + MD5.hex_md5(JSON.stringify(doc));
    }
    return dbInterface.saveDoc(doc)
        .pipe(NoteRevision._fromDBObject, function(err) { return err; }).promise();
}

function FindCommonAncestor(revA, revB) {
    var ancestorsA = {};
    var ancestorsB = {};

    var deferred = $.Deferred();

    function step(newIDsA, newIDsB) {
        if (newIDsA.length == 0 && newIDsB.length == 0) {
            deferred.reject("No common parent found.");
            return;
        }
        for (var i = 0; i < newIDsA.length; i ++) {
            var id = newIDsA[i];
            ancestorsA[id] = true;
            if (id in newIDsB || id in ancestorsB) {
                deferred.resolve(id);
                return;
            }
        }
        for (var i = 0; i < newIDsB.length; i ++) {
            var id = newIDsB[i];
            ancestorsB[id] = true;
            if (id in ancestorsA) {
                deferred.resolve(id);
                return;
            }
        }

        dbInterface.getRevisionParents(newIDsA)
            .fail(function(err) { deferred.reject(err); })
            .done(function(parentsA) {
                dbInterface.getRevisionParents(newIDsB)
                    .fail(function(err) { deferred.reject(err); })
                    .done(function(parentsB) {
                        step(parentsA, parentsB);
                    });
            });
    }

    step([revA], [revB]);
    return deferred.promise();
}

noteBrowser = new NoteBrowser();
dbInterface = new DBInterface();

});
