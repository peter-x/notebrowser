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
    this._buttonRevisionGraph = null;

    this._revisionGraphArea = null;
    this._textArea = null;
    this._viewArea = null;

    this._revisionGraph = null;
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
    this._buttonRevisionGraph = $('<button class="btn" style="float: right;" data-toggle="button">Revisions</button>')
        .click(function() { lthis._toggleRevisionGraph(); })
        .appendTo(this._container);

    this._revisionGraphArea = $('<div/>')
        .hide()
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
            lthis._textArea.val(text);
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
NoteViewer.prototype._toggleRevisionGraph = function() {
    var lthis = this;
    if (this._revisionGraph === null) {
        this._revisionGraph = new RevisionGraph(this._note, this._revisionGraphArea);
        this._revisionGraphArea.show('slow', function() {
            lthis._revisionGraph.redraw();
        });
    } else {
        this._revisionGraphArea.toggle('slow');
    }
}

function RevisionGraph(note, container) {
    this._note = note;
    this._revisions = null;
    this._revisionPositions = null;
    this._revisionPositionsInverted = null;

    /* settings */
    this._horDistance = 60;
    this._verDistance = 30;
    this._horBorder = 20;
    this._verBorder = 20;

    this._width = 0;
    this._height = 0;
    this._container = container;
    this._canvas = null;
    this._update();
}
RevisionGraph.prototype._update = function() {
    var lthis = this;
    dbInterface.getRevisionMetadata(this._note.getID())
        .fail(function(err) { NoteBrowser.showError("Error loading revisions: " + err); })
        .done(function(revs) {
            lthis._revisions = revs;
            lthis._updateHierarchy();
            /* XXX is it safe to draw now? (the width is not yet fixed) */
            lthis.redraw();
        });
}
RevisionGraph.prototype._getRoot = function() {
    var id = this._note.getHeadRevisionID();
    while (this._revisions[id].parents.length > 0)
        id = this._revisions[id].parents[0];
    return id;
}
RevisionGraph.prototype._getChildrenMap = function() {
    var children = {};
    for (var id in this._revisions)
        children[id] = [];
    for (var id in this._revisions) {
        this._revisions[id].parents.forEach(function(p) {
            children[p].push(id);
        });
    }
    return children;
}
RevisionGraph.prototype._updateHierarchy = function() {
    var root = this._getRoot();
    var children = this._getChildrenMap();

    this._revisionPositions = {};
    var queue = {};
    queue[root] = 1;
    var x = 0;
    var cont = true;

    while (cont) {
        cont = false;
        var nextQueue = {};
        var thisColumn = [];
        for (var r in queue) {
            if (this._allParentsArePositioned(r)) {
                thisColumn.push(r);
                for (var i = 0; i < children[r].length; i ++) {
                    nextQueue[children[r][i]] = 1;
                    cont = true;
                }
            } else {
                nextQueue[r] = 1;
                cont = true;
            } 
        }
        queue = nextQueue;

        thisColumn.sort();
        for (var i = 0; i < thisColumn.length; i ++)
            this._revisionPositions[thisColumn[i]] = [x, i - thisColumn.length / 2];

        x ++;
    }
    this._updateRevisionPositionsInverted();
}
RevisionGraph.prototype._updateRevisionPositionsInverted = function() {
    this._revisionPositionsInverted = {};
    this._width = 0;
    this._height = 0;
    for (var id in this._revisionPositions) {
        var pos = this._revisionPositions[id];
        this._revisionPositionsInverted[pos[0] + ',' + pos[1]] = id;
        this._width = Math.max(this._width, pos[0]);
        this._height = Math.max(this._height, Math.abs(pos[1]) * 2);
    }
    this._width = this._width * this._horDistance + 2 * this._horBorder;
    this._height = this._height * this._verDistance + 2 * this._verBorder;
}
RevisionGraph.prototype._allParentsArePositioned = function(revId) {
    var r = this._revisions[revId];
    for (var i = 0; i < r.parents.length; i ++) {
        if (!(r.parents[i] in this._revisionPositions))
            return false;
    }
    return true;
}
RevisionGraph.prototype._getPosition = function(id) {
    var x = this._revisionPositions[id][0] * this._horDistance + this._horBorder;
    var y = this._canvas[0].height / 2 + this._revisionPositions[id][1] * this._verDistance;
    return [x, y];
}
RevisionGraph.prototype._updateUIElements = function() {
    this._container.empty();
    var div = $('<div style="position: relative; width: 100%; overflow: auto;"/>')
                .appendTo(this._container);
    this._canvas = $('<canvas style="width: 500px; height: 100px;"></canvas>')
        .appendTo(div);
    this._canvas.width(this._width);
    this._canvas.height(this._height);
    this._canvas[0].width = this._width; /* clear and set size */
    this._canvas[0].height = this._height;

    for (var id in this._revisions) {
        var r = this._revisions[id];
        var pos = this._getPosition(id);
        var trigger = $('<div/>');
        trigger.css({position: 'absolute', left: pos[0] - 5, top: pos[1] - 5, width: 10, height: 10});
        trigger.attr('title', r._id);
        trigger.appendTo(div);
        var content = $('<p><b>Date:</b> <span class="date"> </span><br/>' +
                           '<b>Author:</b> <span class="author"> </span><br/>' +
                           '<b>Type:</b> <span class="revType"> </span></p>');
        $('.date', content).text(r.date);
        $('.author', content).text(r.author);
        $('.revType', content).text(r.revType);
        trigger.popover({placement: 'bottom', html: true,
                         content: content.html() });
    }
}
RevisionGraph.prototype.redraw = function() {
    this._updateUIElements();

    var ctx = this._canvas[0].getContext('2d');

    /* draw lines */
    for (var id in this._revisions) {
        var r = this._revisions[id];
        var rPos = this._getPosition(id);

        for (var k = 0; k < r.parents.length; k ++) {
            var p = r.parents[k];
            var pPos = this._getPosition(p);
            ctx.beginPath();
            ctx.lineWidth = 2.5;
            ctx.moveTo(rPos[0], rPos[1]);
            ctx.lineTo(pPos[0], pPos[1]);
            ctx.stroke();
        }
    }

    /* draw circles with white border */
    for (var id in this._revisions) {
        var r = this._revisions[id];
        var rPos = this._getPosition(id);
        ctx.beginPath();
        ctx.fillStyle = "#ffffff";
        ctx.arc(rPos[0], rPos[1], 5, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        if (r.revType === "create") {
            ctx.fillStyle = "#00ff00";
        } else if (r.revType === "auto merge") {
            ctx.fillStyle = "#ffff00";
        } else if (r.revType === "manual merge") {
            ctx.fillStyle = "#ffff7f";
        } else {
            ctx.fillStyle = '#000000';
        }
        ctx.arc(rPos[0], rPos[1], 3, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
    }
}

function DBInterface() {
    this._db = null;
    this._backendType = 'couch'; /* or pouch */
    this._backendUrl = '';

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
                d.resolve(res.rows.map(function(row) {
                    return Note.fromDBObject(row.doc);
                }));
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
            d.resolve(res.rows.map(function(row) {
                return {id: row.id, title: row.key};
            }));
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
                d.resolve(res.rows.map(function(row) {
                    return row.value;
                }));
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
DBInterface.prototype.getRevisionMetadata = function(noteID) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;

    var d = $.Deferred();
    if (this._backendType === 'couch') {
        this._db.view('default/revisionMetadata', {
            success: function(res) {
                var revs = {};
                res.rows.forEach(function(row) {
                    revs[row.value._id] = row.value;
                });
                d.resolve(revs);
            },
            error: function(err) {
                d.reject("Database error: " + err.error + " (" + err.reason + ")");
            },
            reduce: false,
            key: noteID
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
    if (this._headRev === null) {
        return $.Deferred().resolve('').promise();
    } else if (this._headRevObj !== null) {
        return $.Deferred().resolve(lthis._headRevObj.getText()).promise();
    } else {
        return NoteRevision.get(lthis._headRev)
            .pipe(function(h) { return (lthis._headRevObj = h).getText(); },
                  function(err) { return err; });
    }
}
Note.prototype.getHeadRevision = function() {
    var lthis = this;
    if (this._headRevObj !== null) {
        return $.Deferred().resolve(lthis._headRevObj.getText()).promise();
    } else {
        return NoteRevision.get(lthis._headRev);
    }
}
Note.prototype.getHeadRevisionID = function() {
    return this._headRev;
}
Note.prototype._save = function() {
    var lthis = this;

    return this.getText().pipe(function(text) {
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
        return dbInterface.saveDoc(doc).pipe(function(doc) {
            /* TODO could this go wrong if two parallel save operations from this
             * client end up the other way round? */
            lthis._id = doc._id;
            lthis._rev = doc._rev;
            lthis._title = doc.title;
            if (lthis._headRev !== doc.headRev)
                lthis._headRevObj = null;
            lthis._headRev = doc.headRev;
            return lthis;
        });
    });
}
Note.prototype.save = function(data) {
    var lthis = this;
    return NoteRevision.createNew(this._id, data.text, data.author || null, data.date || (new Date()),
                        data.revType || "edit", data.parents || [this._headRev])
        .pipe(function(nr) {
            return lthis._updateToRevision(nr._id, nr);
        }, function(err) {
            return "Error saving revision: " + err;
        });
}
Note.prototype._updateToRevision = function(rev, revObj) {
    var lthis = this;
    /* XXX we shold not store this in the object until saved */
    lthis._headRev = rev;
    lthis._headRevObj = revObj;
    return lthis._save()
        .pipe(null, function(err, conflict) {
            if (!conflict)
                return "Error saving note: " + err;
            return Note.get(lthis._id)
                .pipe(function(currentNote) {
                    return currentNote.mergeWith(lthis, false)
                        .pipe(function() {
                            lthis._rev = currentNote._rev;
                            lthis._title = currentNote._title;
                            lthis._headRev = currentNote._headRev;
                            lthis._headRevObj = currentNote._headRevObj;
                            return lthis;
                        }, function(err) {
                            return "Error saving note (in conflict resolution): " + err;
                        });
                }, function(err) { return "Error saving note: " + err; });
        });
}
Note.prototype.mergeWith = function(otherNote, deleteOther) {
    var lthis = this;
    return lthis.getText()
        .pipe(function() {
            return otherNote.getText()
                .pipe(function() {
                    return lthis._headRevObj.createMergedRevision(otherNote._headRevObj)
                        .pipe(function(newRevObj) {
                            return lthis._updateToRevision(newRevObj.getID(), newRevObj);
                        });
                });
        });
    /* TODO use deleteOther */
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
    /* first create the note to obtain an ID, then save the initial revision */
    var n = new Note();
    return n._save().pipe(function(n) {
        data.parents = [];
        data.revType = "create";
        return n.save(data);
    });
}

function NoteRevision() {
    this._id = null;
    this._rev = null;
    this._note = null;
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
    return this._findCommonAncestor(otherRev)
        .pipe(function(parentId) {
            return NoteRevision.get(parentId)
                .pipe(function(parentRev) {
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
                    return NoteRevision.createNew(lthis._note, textMerged, null, new Date(), "auto merge",
                                          [lthis.getID(), otherRev.getID()]);
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
    return FindCommonAncestor(this._note, this._id, otherRev.getID());
}
/* static */
NoteRevision._fromDBObject = function(doc) {
    var nr = new NoteRevision();
    nr._id = doc._id;
    nr._rev = doc._rev;
    nr._note = doc.note;
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
NoteRevision.createNew = function createNew(noteID, text, author, date, revType, parents) {
    var doc = {
        type: "noteRevision",
        note: noteID,
        date: date,
        author: author,
        revType: revType,
        parents: parents.sort(),
        text: text
    }
    doc._id = 'rev-' + MD5.hex_md5(JSON.stringify(doc));
    return dbInterface.saveDoc(doc)
        .pipe(NoteRevision._fromDBObject, function(err) { return err; }).promise();
}

/* TODO use some view that retrieves all metadata for all revisions */
function FindCommonAncestor(note, revA, revB) {
    return dbInterface.getRevisionMetadata(note)
        .pipe(function(revisions) {
            var ancestorsA = {};
            var ancestorsB = {};
            var newIDsA = [revA];
            var newIDsB = [revB];

            function getAllParents(ids) {
                var parents = {};
                ids.forEach(function(id) {
                    revisions[id].parents.forEach(function(p) {
                        parents[p] = 1;
                    });
                });
                var list = [];
                for (var p in parents)
                    list.push(p);
                return list
            }

            while (newIDsA.length > 0 || newIDsB.length > 0) {
                for (var i = 0; i < newIDsA.length; i ++) {
                    var id = newIDsA[i];
                    ancestorsA[id] = true;
                    if (id in newIDsB || id in ancestorsB)
                        return $.Deferred().resolve(id).promise();
                }
                for (var i = 0; i < newIDsB.length; i ++) {
                    var id = newIDsB[i];
                    ancestorsB[id] = true;
                    if (id in ancestorsA)
                        return $.Deferred().resolve(id).promise();
                }

                newIDsA = getAllParents(newIDsA);
                newIDsB = getAllParents(newIDsB);
            }

            return $.Deferred().reject("No common parent found.").promise();
        });
}

noteBrowser = new NoteBrowser();
dbInterface = new DBInterface();

});
