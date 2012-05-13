/* XXX aw, globals! use some module loader */
var noteBrowser;
var dbInterface;
$(function() {
"use strict";


function NoteBrowser() {
    this.currentNoteID = new LiveValue(null);

    this._noteViewer = null;

    var lthis = this;
    this._changeListener = null;

    window.setTimeout(function() {
        lthis._changeListener = dbInterface.on('change', function(doc) {
            if (doc.type && doc.type == 'syncTarget') {
                lthis._updateSyncTargetButton(new SyncTarget(doc));
            }
        });

        lthis._noteList = new NoteList();
        lthis._syncTargetList = new SyncTargetList();
        lthis._init();
    }, 10);
}
NoteBrowser.prototype.destroy = function() {
    if (this._changeListener !== null) {
        dbInterface.off('change', this._changeListener);
        this._changeListener = null;
    }
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
        lthis.showNote(hash.substr(1));
    }

    $(window).on('hashchange', checkHash);
    dbInterface.on('ready', checkHash);

    $('#newNoteButton').click(function() {
        Note.create('# New Note\n')
            .fail(function(err) { lthis.showError(err); })
            .done(function(note) {
                if (lthis._noteViewer !== null) {
                    /* XXX allow it to ask the user to save or not */
                    lthis._noteViewer.destroy();
                }
                lthis._noteViewer = new NoteViewer(note);
                lthis._noteViewer.show(true);
                lthis.currentNoteID.set(note.getID());
            });
    });
    $('#newSyncButton').click(function() {
        /* TODO improve this */
        var name = prompt("Name");
        if (!name) return;
        var url = prompt("URL");
        if (!url) return;

        SyncTarget.create(name, url)
            .fail(function(err) { noteBrowser.showError(err); });
    });
    dbInterface.on('ready', function() {
        lthis._updateSyncTargetButtons();
    });
}
NoteBrowser.prototype.showError = function(message) {
    $('<div class="alert alert-error"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
        .append($('<p/>')
            .text(String(message)))
        .alert()
        .appendTo('#messageArea');
}
NoteBrowser.prototype.showInfo = function(message) {
    $('<div class="alert alert-info"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
        .append($('<p/>')
            .text(String(message)))
        .alert()
        .appendTo('#messageArea');
}
NoteBrowser.prototype._updateSyncTargetButtons = function() {
    var lthis = this;
    dbInterface.getAllSyncTargets().done(function(targets) {
        targets.forEach(function(t) {
            lthis._updateSyncTargetButton(t);
        });
    });
}
NoteBrowser.prototype._updateSyncTargetButton = function(target) {
    $('#synctargetbutton_' + target.getID(), '#syncTargetButtons').remove();
    $('<li id="synctargetbutton_' + target.getID() + '"/>')
        .append($('<a href="#"/>')
            .text(target.getName())
            .click(function(e) {
                target.doSync()
                    .done(function() {
                        noteBrowser.showInfo("Synchronized with " + target.getName());
                    })
                    .fail(function(e) {
                        noteBrowser.showError("Error synchronizing with " + target.getName() + ": " + e);
                    });
                e.preventDefault();
                return true;
            }))
        .appendTo('#syncTargetButtons');
}
NoteBrowser.prototype.showNote = function(id, revision) {
    /* TODO update location hash */
    var lthis = this;
    $('#noteArea').empty();
    /* TODO also try to show the note by name */
    new Note(id).getConstructorPromise()
        .done(function(note) {
            if (lthis._noteViewer !== null) {
                /* XXX allow it to ask the user to save or not */
                lthis._noteViewer.destroy();
            }
            lthis._noteViewer = new NoteViewer(note, revision);
            lthis._noteViewer.show();
            lthis.currentNoteID.set(note.getID());
        })
        .fail(function(err) { lthis.showError(err); });
}

function NoteViewer(note, revision) {
    this._note = note;
    this._revision = revision;

    this._editMode = false;

    this._container = null;
    this._buttonEdit = null;
    this._buttonSave = null;
    this._buttonCancel = null;
    this._buttonRevisionGraph = null;

    this._revisionGraphArea = null;
    this._syncTableArea = null;
    this._textArea = null;
    this._viewArea = null;

    this._syncTable = null;
    this._revisionGraph = null;

    this._changeListener = null;
    this._installChangeListener();
}
NoteViewer.prototype.destroy = function() {
    if (this._revisionGraph !== null) {
        this._revisionGraph.destroy();
        this._revisionGraph = null;
    }
    dbInterface.off('change', this._changeListener);
}
NoteViewer.prototype._installChangeListener = function() {
    var lthis = this;
    if (this._changeListener === null) {
        this._changeListener = dbInterface.on('change', function(doc) {
            if (doc.type && doc.type == 'note' && doc._id && doc._id === lthis._note.getID()) {
                if (lthis._editMode === false && lthis._revision === undefined) {
                    lthis._note.setDBObj(doc);
                    lthis.showRevision();
                    /* XXX it should have its own listener */
                    lthis._updateSyncTable();
                }
            }
        });
    }
}
NoteViewer.prototype.show = function(editMode) {
    var lthis = this;

    this._container = $('<div/>');
    this._buttonEdit = $('<button class="btn"><i class="icon-edit"/> Edit</button>')
        .click(function() { lthis._toEditMode(); })
        .appendTo(this._container);
    this._buttonCancel = $('<button class="btn">Cancel</button>')
        .click(function() { lthis._cancelChanges(); })
        .appendTo(this._container);
    this._buttonSave = $('<button class="btn btn-primary">Save</button>')
        .click(function() { lthis._saveChanges(); })
        .appendTo(this._container);
    this._buttonRevisionGraph = $('<button class="btn" data-toggle="button">Revisions</button>')
        .click(function() { lthis._toggleRevisionGraph(); })
        .appendTo(this._container);

    this._revisionGraphArea = $('<div/>')
        .hide()
        .appendTo(this._container);
    
    this._syncTableArea = $('<div/>')
        .appendTo(this._container);

    this._textArea = $('<textarea style="width: 100%; height: 800px; margin-top: 10px;"></textarea>')
        .appendTo(this._container);

    this._viewArea = $('<div/>')
        .appendTo(this._container);

    this._updateSyncTable();

    if (editMode) {
        this._toEditMode();
    } else {
        this._toViewMode();
    }

    $('#noteArea').empty();
    this._container.appendTo('#noteArea');
}
NoteViewer.prototype.showRevision = function(rev) {
    this._revision = rev;
    if (this._revisionGraph !== null)
        this._revisionGraph.setCurrentRevision(rev === undefined ? this._note.getHeadRevisionID() : rev);
    this._toViewMode();
}
NoteViewer.prototype._toEditMode = function() {
    var lthis = this;
    /* XXX progress indicator */
    this._note.getText(this._revision)
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
    this._note.getText(this._revision)
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
            MathJax.Hub.Queue(["Typeset", MathJax.Hub, lthis._viewArea[0]]);
            lthis._textArea.empty();
            lthis._textArea.hide();
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });

}
NoteViewer.prototype._updateSyncTable = function() {
    var lthis = this;
    this._syncTableArea.empty();
    /* XXX do we need to call this each time? */
    dbInterface.getAllSyncTargets()
        .done(function(targets) {
            var table = $('<table class="table table-striped table-bordered"><thead>' +
                                '<tr><th>Sync Target</th><th>&nbsp;</th></tr>' +
                                '</thead></table>');
            var tbody = $('<tbody/>').appendTo(table);
            targets.forEach(function(target) {
                /* XXX update this */
                var seq = lthis._note.getLocalSeq(target.getID());
                var tr = $('<tr/>')
                    .append($('<td/>').text(target.getName()));
                if (seq === undefined) {
                    $('<button class="btn btn-small inline">set to sync</button>')
                        .click(function() {
                            lthis._note.setLocalSeq(target.getID(), 0)
                                .done(function() {
                                    lthis._updateSyncTable();
                                });
                        })
                        .appendTo($('<td/>').appendTo(tr));
                } else {
                    tr.append($('<td/>').text(lthis._note.getLocalSeq(target.getID())))
                }
                tr.appendTo(tbody);
            });
            table.appendTo(lthis._syncTableArea);
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });
}
NoteViewer.prototype._saveChanges = function() {
    if (this._revision !== undefined) {
        if (!confirm("You are possibly saving an old revision. This will overwrite changes."))
            return;
    }
    var text = this._textArea.val();

    var lthis = this;
    /* XXX if we are viewing an old revision, then mark it as manual
     * merge and adjust the parents appropriately. */
    this._note.setText(this._textArea.val())
        .done(function(val) {
            if (lthis._revisionGraph)
                lthis._revisionGraph.setCurrentRevision(lthis._note.getHeadRevisionID());
            /* XXX we will get double renderings because of the changes feed */
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
        var rev = this._revision;
        if (rev === undefined)
            rev = this._note.getHeadRevisionID();
        this._revisionGraph = new RevisionGraph(this, this._note, rev, this._revisionGraphArea);
        this._revisionGraphArea.show('slow', function() {
            lthis._revisionGraph.redraw();
        });
    } else {
        this._revisionGraphArea.toggle('slow');
    }
}

function RevisionGraph(noteViewer, note, revision, container) {
    this._noteViewer = noteViewer;

    this._note = note;
    this._currentRevision = revision;

    this._revisions = null;
    this._revisionPositions = null;

    this._changeListener = null;

    /* settings */
    this._horDistance = 60;
    this._verDistance = 30;
    this._horBorder = 20;
    this._verBorder = 10;

    this._width = 0;
    this._height = 0;
    this._container = container;
    this._canvas = null;

    this._revisions = {};
    this.redraw();

    this._installChangeListener();
    this._update();
}
RevisionGraph.prototype.destroy = function() {
    /* TODO make sure this gets called */
    dbInterface.off('change', this._changeListener);
}
RevisionGraph.prototype._installChangeListener = function() {
    var lthis = this;
    if (lthis._changeListener === null) {
        lthis._changeListener = dbInterface.on('change', function(doc) {
            if (doc.type && doc.type == 'noteRevision' && doc.note && doc.note === lthis._note.getID()) {
                lthis._revisions[doc._id] = doc;
                lthis._updateHierarchy();
                lthis.redraw();
            }
        });
    }
}
RevisionGraph.prototype._update = function() {
    var lthis = this;
    dbInterface.getRevisionMetadata(this._note.getID())
        .fail(function(err) { NoteBrowser.showError("Error loading revisions: " + err); })
        .done(function(revs, updateSeq) {
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
    var maxColumn = 0;

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

        maxColumn = Math.max(maxColumn, thisColumn.length);

        thisColumn.sort();
        for (var i = 0; i < thisColumn.length; i ++)
            this._revisionPositions[thisColumn[i]] = [x, i - (thisColumn.length - 1) / 2];

        x ++;
    }
    
    this._width = (x - 1) * this._horDistance + 2 * this._horBorder;
    this._height = (maxColumn - 1) * this._horDistance + 2 * this._verBorder;
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
    if (!(id in this._revisionPositions)) {
        return [5, 5];
    }
    var x = this._revisionPositions[id][0] * this._horDistance + this._horBorder;
    var y = this._height / 2 + this._revisionPositions[id][1] * this._verDistance;
    return [x, y];
}
RevisionGraph.prototype._updateUIElements = function() {
    this._container.empty();
    var div = $('<div style="position: relative; width: 100%; height: 160px; overflow: auto;"/>')
                .appendTo(this._container);
    this._canvas = $('<canvas style="width: 500px; height: 100px;"></canvas>')
        .appendTo(div);
    this._canvas.width(this._width);
    this._canvas.height(this._height);
    this._canvas[0].width = this._width; /* clear and set size */
    this._canvas[0].height = this._height;

    var infoDiv = $('<div/>')
        .appendTo(this._container);
    var currentHover = null;

    var lthis = this;

    function showInfo(rid) {
        infoDiv.empty();
        infoDiv.removeClass('disabled');
        currentHover = rid;
        var content = $('<h4><span class="title"> </span></h4>' +
                        '<p><b>Date:</b> <span class="date"> </span><br/>' +
                        '<b>Author:</b> <span class="author"> </span><br/>' +
                        '<b>Parents:</b> <span class="parents"> </span><br/>' +
                        '<b>Type:</b> <span class="revType"> </span></p>');
        if (rid in lthis._revisions) {
            var r = lthis._revisions[rid];
            $('.date', content).text(r.date);
            $('.author', content).text(r.author);
            $('.revType', content).text(r.revType);
            $('.parents', content).text(r.parents.join(', '));
            $('.title', content).text(r._id);
        }
        content.appendTo(infoDiv);
    }
    $.each(this._revisions, function(id, r) {
        var pos = lthis._getPosition(id);
        var trigger = $('<div/>');
        trigger.css({position: 'absolute', left: pos[0] - 5, top: pos[1] - 5, width: 10, height: 10});

        trigger.hover(function() { showInfo(r._id); }, function() {
            if (currentHover === r._id)
                infoDiv.addClass('disabled');
        });
        trigger.click(function() {
            lthis._noteViewer.showRevision(r._id);
        });
        trigger.appendTo(div);
    });
    showInfo(this._currentRevision);
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
        var hilight = (id === this._currentRevision);
        ctx.beginPath();
        ctx.fillStyle = "#ffffff";
        ctx.arc(rPos[0], rPos[1], hilight ? 8 : 5, 0, Math.PI * 2, true);
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
        ctx.arc(rPos[0], rPos[1], hilight ? 6 : 3, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
    }
}
RevisionGraph.prototype.setCurrentRevision = function(revision) {
    this._currentRevision = revision;
    this.redraw();
}

var DBInterface = (function() {


function PouchDB(dbName) {
}
PouchDB.prototype._ini = function() {
    var lthis = this;
    new Pouch('idb://notebrowser', function(err, db) {
        if (err) {
            noteBrowser.showError("Database error: " + err.error + " (" + err.reason + ")");
            return;
        }
        lthis._db = db;
        lthis._registerChangesFeed();
        lthis._trigger('ready');
    });
}
PouchDB.prototype.getAllNoteTitles = function() {
    /* TODO */
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
PouchDB.prototype.getDoc = function(id) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    this._db.get(id, function(err, doc) {
        if (err) {
            d.reject("Database error: " + err.error + " (" + err.reason + ")");
        } else {
            d.resolve(doc);
        }
    });
    return d.promise();
}
PouchDB.prototype.saveDoc = function(doc) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
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
    return d.promise();
}

function CouchDB() {
    this._db = null;
    this._dbName = null;

    var lthis = this;
    window.setTimeout(function() {
        lthis._dbName = unescape(document.location.href).split('/')[3];
        lthis._init();
    }, 10);
}

CouchDB.prototype._init = function() {
    var lthis = this;
    $.couch.urlPrefix = '';
    var db = $.couch.db(this._dbName);

    db.info({success: function(res) {
        lthis._db = db;
        lthis._registerChangesFeed(res.update_seq);
        lthis._trigger('ready');
    }});
}
CouchDB.prototype._registerChangesFeed = function(updateSeq) {
    if (!this._db)
        return;
    
    var lthis = this;
    this._db.changes(updateSeq, {include_docs: true})
        .onChange(function(res) {
            res.results.forEach(function(result) {
                lthis._trigger('change', result.doc, result.changes, res.last_seq);
            });
        });
}
CouchDB.prototype.determineAvailableNoteRevisions = function(keys) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();
    
    var ajaxOpts = {type: 'GET',
                    contentType: 'application/json',
                    dataType: 'json',
                    accept: 'application/json',
                    cache: !$.browser.msie};
    return $.ajax($.extend(ajaxOpts, {
                        type: 'POST',
                        url: '/' + this._dbName + '/_all_docs',
                        processData: false,
                        data: JSON.stringify({keys: keys, include_docs: false})}))
        .pipe(function(res) {
            var available = {};
            res.rows.forEach(function(row) {
                if (!('error' in row)) available[row.key] = 1;
            });
            return available;
        }, function(req, error) {
            return "Error determining objects available on local serer: " + error;
        });
}
CouchDB.prototype.getAllNoteTitles = function() {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    this._db.view('default/notesByTitle', {
        success: function(res) {
            d.resolve(res.rows.map(function(row) {
                return new Note(row.doc);
            }));
        },
        error: function(err) {
            d.reject("Database error: " + err);
        },
        reduce: false,
        include_docs: true
    });
    return d.promise();
}
CouchDB.prototype.getNotesToSync = function(syncTarget) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    this._db.view('default/notesToSync', {
        success: function(res) {
            d.resolve(res.rows.map(function(row) {
                return new Note(row.doc);
            }));
        },
        error: function(err) {
            d.reject("Database error: " + err);
        },
        reduce: false,
        key: syncTarget,
        include_docs: true
    });
    return d.promise();
}
CouchDB.prototype.getAllSyncTargets = function() {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    this._db.view('default/syncTargets', {
        success: function(res) {
            d.resolve(res.rows.map(function(row) {
                return new SyncTarget(row.doc);
            }));
        },
        error: function(err) {
            d.reject("Database error: " + err);
        },
        reduce: false,
        include_docs: true
    });
    return d.promise();
}
CouchDB.prototype.getDoc = function(id) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    this._db.openDoc(id, {
        /* XXX check if the id we got matches the id we requested */
        success: function(doc) { d.resolve(doc); },
        error: function(err) { d.reject("Database error: " + err); }
    });
    return d.promise();
}
CouchDB.prototype.getRevisionMetadata = function(noteID) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    var opts = {
        success: function(res) {
            var revs = {};
            res.rows.forEach(function(row) {
                revs[row.value._id] = row.value;
            });
            d.resolve(revs, res.update_seq);
        },
        error: function(err) {
            d.reject("Database error: " + err);
        },
        update_seq: true,
        reduce: false};
    if ($.isArray(noteID)) {
        opts.keys = noteID;
    } else {
        opts.key = noteID;
    }
    this._db.view('default/revisionMetadata', opts);
    return d.promise();

}
CouchDB.prototype.changedRevisions = function(noteID, since) {
    var ajaxOpts = {type: 'GET',
                    dataType: 'json',
                    accept: 'application/json',
                    cache: !$.browser.msie};
    /* XXX for testing */
    since = 0;
    return $.ajax($.extend(ajaxOpts, {
                        url: '/' + this._dbName + '/_changes',
                        data: {filter: 'default/noteRevisions',
                            note: noteID,
                            include_docs: true,
                            since: since}}))
        .pipe(function(res) {
            return {lastSeq: res.last_seq,
                    revisions: $.map(res.results, function(r) {
                        return r.doc;
                    })};
        }, function(req, error) {
            return "Error determining changed revisions on local serer: " + error;
        });
}
CouchDB.prototype.saveDocs = function(docs) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
    this._db.bulkSave({docs: docs}, {
        success: function(res) {
            d.resolve(res);
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
    return d.promise();
}
CouchDB.prototype.saveDoc = function(doc) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    var d = $.Deferred();
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
    return d.promise();
}
addEvents(CouchDB, ['ready', 'change']);

function InMemoryDB() {
    this._changeLog = null;
    this._initialized = false;

    this._notes = null;
    this._noteRevisions = null;
    this._syncTargets = null;
    this._revisionsForNote = null;
    this._syncTargetNotes = null;

    this._lastAutoSave = -1;

    var lthis = this;
    window.setTimeout(function() {
        var noteBrowserData = window.noteBrowserData;
        if (!noteBrowserData)
            noteBrowserData = {notes: {}, noteRevisions: {}, syncTargets: {}, changeLog: []};
        try {
            lthis._import(noteBrowserData);
            lthis._initialized = true;
            noteBrowserData = window.noteBrowserData = null;
        } catch (e) {
            noteBrowser.showError("Error loading local data: " + e.message);
            return;
        }
        lthis._trigger('ready');
    }, 10);
    this._autoSaveInterval = window.setInterval(function() {
        if (lthis._initialized)
            lthis._autoSave();
    }, 5000);
}
InMemoryDB.prototype.determineAvailableNoteRevisions = function(keys) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var available = {};
    keys.forEach(function(k) {
        if (k in lthis._noteRevisions) available[k] = 1;
    });

    return $.when(available);
}
InMemoryDB.prototype.getAllNoteTitles = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var notes = $.map(this._notes, function(n) { return n; });
    notes.sort(function(n1, n2) { return n1.title > n2.title; });
    return $.when($.map(notes, function(n) { return new Note(n);}));
}
InMemoryDB.prototype.getNotesToSync = function(syncTargetID) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var notes = this._syncTargetNotes[syncTargetID];
    return $.when($.map(notes, function(n) { return new Note(n); }));
}
InMemoryDB.prototype.getAllSyncTargets = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var targets = $.map(this._syncTargets, function(n) { return n; });
    targets.sort(function(t1, t2) { return t1.name > t2.name; });
    return $.when($.map(targets, function(t) { return new SyncTarget(t);}));
}
InMemoryDB.prototype._getDoc = function(id) {
    if (id in this._notes)
        return this._notes[id];
    if (id in this._noteRevisions)
        return this._noteRevisions[id];
    if (id in this._syncTargets)
        return this._syncTargets[id];
    return undefined;
}
InMemoryDB.prototype.getDoc = function(id) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var doc = this._getDoc(id);
    if (doc === undefined) {
        return $.Deferred().reject("Document not found.").promise();
    } else {
        return $.when(doc);
    }
}
InMemoryDB.prototype.getRevisionMetadata = function(noteID) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    /* contains more data than needed, but it would take more time to filter
     * it*/
    return $.when(this._revisionsForNote[noteID]);
}
InMemoryDB.prototype.changedRevisions = function(noteID, since) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    /* XXX correct to start at "since"? */
    var revs = [];
    for (var i = since; i < this._changeLog.length; i ++) {
        var id = this._changeLog[i];
        if (id in this._noteRevisions) {
            var r = this._noteRevisions[id];
            if (r.note === noteID)
                revs.push(r);
        }
    }
    return $.when({lastSeq: this._changeLog.length - 1,
                   revisions: revs});
}
InMemoryDB.prototype._saveDoc = function(doc) {
    var lthis = this;

    if (!('_id' in doc))
        doc._id = this._genID();
    if (!('_rev' in doc))
        doc._rev = '0-x';

    doc._rev = this._getIncrementedRev(doc);

    var olddoc = this._getDoc(doc._id);
    if (olddoc !== undefined) {
        if (olddoc._rev === doc._rev) {
            /* no conflict, no save */
            /* XXX change notification? */
            return 0;
        } else if (!this._olderRev(olddoc._rev, doc._rev)) {
            return -1;
        }
    }

    if (doc.type == 'note') {
        this._notes[doc._id] = doc;
        if (olddoc !== undefined) {
            $.each(olddoc.syncWith, function(syncTargetID) {
                delete lthis._syncTargetNotes[syncTargetID][olddoc._id];
            });
        }
        $.each(doc.syncWith, function(syncTargetID) {
            if (!(syncTargetID in lthis._syncTargetNotes))
                lthis._syncTargetNotes[syncTargetID] = {};
            lthis._syncTargetNotes[syncTargetID][doc._id] = doc;
        });
    } else if (doc.type == 'noteRevision') {
        this._noteRevisions[doc._id] = doc;
        /* we assume that the referenced note does never change */
        if (!(doc.note in this._revisionsForNote))
            this._revisionsForNote[doc.note] = {};
        this._revisionsForNote[doc.note][doc._id] = doc;
    } else if (doc.type === 'syncTarget') {
        this._syncTargets[doc._id] = doc;
    } else {
        return -2;
    }

    this._changeLog.push(doc._id);

    /* TODO only trigger it after promise resolution? */
    this._trigger('change', doc);

    return 1;
}
InMemoryDB.prototype.saveDoc = function(doc) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var res = this._saveDoc(doc);
    if (res >= 0)
        return $.when(doc);
    if (res == -1)
        return $.Deferred().reject("Conflict.", true).promise();
    if (res == -2)
        return $.Deferred().reject("Invalid document type.").promise();
    return $.Deferred().reject("Database error.").promise();
}
InMemoryDB.prototype.saveDocs = function(docs) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    for (var i = 0; i < docs.length; i ++) {
        this.saveDoc(docs[i]);
    }

    /* XXX return value is currently ignored */
    return $.when("Documents saved.");
}
InMemoryDB.prototype._genID = function() {
    var id = '';
    for (var i = 0; i < 32; i += 4) {
        var part = Math.floor((Math.random() * 0x10000)).toString(16);
        id += '0000'.substr(part.length) + part.substr(0, 4);
    }
    return id;
}
InMemoryDB.prototype._getIncrementedRev = function(doc) {
    var copy = $.extend(true, {}, doc);
    var num = (copy._rev.split('-')[0] - 0) + 1;

    /* XXX use some normal form */
    return num + '-' + MD5.hex_md5(JSON.stringify(copy));
}
InMemoryDB.prototype._olderRev = function(reva, revb) {
    var partsa = reva.split('-');
    var partsb = revb.split('-');
    return (partsa[0] < partsb[0]);
}
InMemoryDB.prototype._export = function() {
    var data = {notes: this._notes,
                   noteRevisions: this._noteRevisions,
                   syncTargets: this._syncTargets,
                   changeLog: this._changeLog};
    return JSON.stringify(data);
}
InMemoryDB.prototype._import = function(data) {
    var revisionsForNote = {};
    var syncTargetNotes = {};

    $.each(data.notes, function(id, note) {
        $.each(note.syncWith, function(syncTargetID) {
            if (!(syncTargetID in syncTargetNotes))
                syncTargetNotes[syncTargetID] = {};
            syncTargetNotes[syncTargetID][note._id] = note;
        });
    });

    $.each(data.noteRevisions, function(id, rev) {
        if (!(rev.note in revisionsForNote))
            revisionsForNote[rev.note] = {};
        revisionsForNote[rev.note][rev._id] = rev;
    });

    this._notes = data.notes;
    this._noteRevisions = data.noteRevisions;
    this._syncTargets = data.syncTargets;

    this._changeLog = data.changeLog;

    this._revisionsForNote = revisionsForNote;
    this._syncTargetNotes = syncTargetNotes;
}
InMemoryDB.prototype._autoSave = function() {
    try {
        netscape.security.PrivilegeManager.enablePrivilege("UniversalXPConnect");
    } catch (e) {
        noteBrowser.showError("Permission to save files was denied. Please use Firefox to save notes.");
        window.clearInterval(this._autoSaveInterval);
        this._autoSaveInterval = null;
        return;
    }
    if (this._lastAutoSave == this._changeLog.length)
        return;
    /* XXX detect if another window writes to this file */
    var path = document.location.pathname.replace(/\/index.html$/, '');
    var data = 'noteBrowserData = ' + this._export() + ';';

    var file = Components.classes["@mozilla.org/file/local;1"]
                    .createInstance(Components.interfaces.nsILocalFile);
    file.initWithPath(path + '/data.jsonp');
    if (!file.exists())
        file.create(0, 0x01B4);
    var outputStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                    .createInstance(Components.interfaces.nsIFileOutputStream);
    outputStream.init(file, 0x22, 0x04, null);

    outputStream.write(data, data.length);
    outputStream.close();

    this._lastAutoSave = this._changeLog.length;
}
addEvents(InMemoryDB, ['ready', 'change']);

/* XXX better check if couchdb is there */

var url = document.location.href;
if (url.match(/file:\/\//)) {
    return InMemoryDB; /* XXX or pouchdb if possible */
} else if (url.match(/\/_design\//)) {
    return CouchDB;
} else {
    return InMemoryDB;
}

})();


function SyncTargetList() {
    this._changeListener = null;

    var lthis = this;
    dbInterface.on('ready', function() { lthis.update(); });
    this._changeListener = dbInterface.on('change', function(doc) {
        if (doc.type && doc.type === 'syncTarget') {
            lthis._updateListEntry(new SyncTarget(doc));
        }
    });
}
SyncTargetList.prototype.destroy = function() {
    if (this._changeListener !== null)
        dbInterface.off('change', this._changeListener);
    this._changeListener = null;
}
SyncTargetList.prototype._updateListEntry = function(target) {
    $('#synctarget_' + target.getID(), '#syncTableBody').remove();
    $('<tr id="synctarget_' + target.getID() + '"/>')
                    .append($('<td/>').text(target.getName()))
                    .append($('<td/>').text(target.getURL()))
                    .appendTo('#syncTableBody');
}
SyncTargetList.prototype.update = function() {
    var lthis = this;

    $('#syncTableBody').empty();
    dbInterface.getAllSyncTargets()
        .done(function(targets) {
            targets.forEach(function(target) {
                lthis._updateListEntry(target);
            });
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });
}

function NoteList() {
    /* TODO search */

    this._changeListener = null;

    var lthis = this;

    this._installChangeListener();
    noteBrowser.currentNoteID.getLive(function(val) {
        lthis._setListHilight(val);
    });
    dbInterface.on('ready', function() { lthis.update(); });
}
NoteList.prototype.destroy = function() {
    if (lthis._changeListener !== null)
        dbInterface.off('change', lthis._changeListener);
    lthis._changeListener = null;
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
    return $('<li/>', {'data-noteid': id})
        .append($('<a/>', {href: '#' + encodeURIComponent(id)})
                .text(title));
}
NoteList.prototype._setListHilight = function(id) {
    $('#noteListStart ~ li').removeClass('active');
    /* XXX how to escape? */
    $('#noteListStart ~ li[data-noteid="' + id  + '"]').addClass('active');
}
NoteList.prototype._installChangeListener = function() {
    var lthis = this;
    if (lthis._changeListener === null) {
        lthis._changeListener = dbInterface.on('change', function(doc) {
            if (doc.type && doc.type === 'note') {
                var note = new Note(doc);
                $('#noteListStart ~ li[data-noteid="' + note.getID() + '"]').remove();
                lthis._insertNote(note);

                var hilightID = noteBrowser.currentNoteID.get();
                if (hilightID === note.getID())
                    lthis._setListHilight(hilightID);
            }
        });
    }
}
NoteList.prototype._insertNote = function(note) {
    var title = note.getTitle();
    var lis = $('#noteListStart ~ li');
    var a = 0, b = lis.length;
    while (b - a > 1) {
        var m = Math.floor((a + b) / 2);
        /* XXX which collation? */
        if (title < $(lis[m]).text()) {
            b = m;
        } else {
            a = m;
        }
    }

    var l = this._getNoteLink(note.getID(), title);
    if (lis.length == 0) {
        l.insertAfter('#noteListStart');
    } else if (title < $(lis[a]).text()) {
        l.insertBefore($(lis[a]));
    } else {
        l.insertAfter($(lis[a]));
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


var Note = DBObject.extend({
    _init: function(id) {
        this._title = null;
        this._headRevObj = null;

        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'note';
            this._dbObj.title = '';
            this._dbObj.headRev = null; /* should not be saved like that */
            this._dbObj.syncWith = {};
        }
    },
    setDBObj: function(dbObj) {
        /* headRev can be null at the first save */
        if (dbObj.type === 'note' && typeof(dbObj.title) === 'string' && typeof(dbObj.syncWith) === 'object') {
            if (this._dbObj.headRev !== dbObj.headRev)
                this._headRevObj = null;
            this._super(dbObj);
        } else {
            throw new Error("Invalid note object from database.");
        }
    },
    getTitle: function() {
        return this._dbObj.title;
    },
    getText: function(revisionID) {
        var lthis = this;
        if (revisionID !== undefined && revisionID !== this._dbObj.headRev) {
            return (new NoteRevision(revisionID)).getConstructorPromise()
                .pipe(function(nr) {
                    if (nr.getNoteID() !== lthis.getID())
                        return $.Deferred().reject("Invalid revision object " + nr.getID()).promise();
                    return nr.getText();
                });
        } else {
            return this.getHeadRevision().pipe(function(hr) {
                return hr.getText();
            });
        }
    },
    getHeadRevision: function() {
        if (this._headRevObj !== null) {
            if (this._headRevObj.getID() === this._dbObj.headRev) {
                return $.when(this._headRevObj);
            } else {
                this._headRevObj = null;
            }
        }

        if (this._dbObj.headRev === null)
            return $.when(null).promise();

        var lthis = this;
        return (new NoteRevision(this._dbObj.headRev)).getConstructorPromise().pipe(function(nr) {
            if (nr.getNoteID() !== lthis.getID())
                return $.Deferred().reject("Invalid revision object " + nr.getID()).promise();
            if (nr.getID() === lthis._dbObj.headRev)
                lthis._headRevObj = nr;
            /* return the revision from the time the request was made and not the current one */
            return nr;
        });
    },
    getHeadRevisionID: function() {
        return this._dbObj.headRev;
    },
    getLocalSeq: function(syncTarget) {
        return this._dbObj.syncWith[syncTarget];
    },
    setText: function(text, author, date, revType, parents) {
        var lthis = this;
        var nr = new NoteRevision();
        return nr.save(this.getID(), text, author || null, date || (new Date()),
                            revType || "edit", parents || [this._dbObj.headRev])
            .pipe(function(nr) {
                try {
                    return lthis._updateToRevision(nr);
                } catch(e) {
                    return $.Deferred().reject("Error saving revision: " + e.message).promise();
                }
            }, function(err) {
                return "Error saving revision: " + err;
            });
    },
    _updateToRevision: function(revObj) {
        var lthis = this;
        var currentRev = lthis._dbObj.headRev;
        return this._save(function(dbObj) {
            if (dbObj.headRev === currentRev) {
                /* no conflict */
                dbObj.headRev = revObj.getID();
                dbObj.title = revObj.getTitle();
                return dbObj;
            } else {
                /* conflict */
                /* XXX if this does not work, the current object loses its
                 * revision */
                return lthis.getHeadRevision().pipe(function(otherRevObj) {
                    /* XXX catch exceptions here, or better modify jquery's
                     * deferred to convert exceptions into rejects */
                    return revObj.createMergedRevision(otherRevObj).pipe(function(newRevObj) {
                        currentRev = newRevObj.getID();
                        dbObj.headRev = newRevObj.getID();
                        dbObj.title = newRevObj.getTitle();
                        return dbObj;
                    });
                });
            }
        }).pipe(function() {
            /* avoid refetching revObj */
            if (lthis._dbObj.headRev === revObj.getID()) {
                lthis._headRevObj = revObj;
            }
            return lthis;
        });
    },
    /* TODO merge: we have to handle the special case where one of the Notes is the
     * parent of the other note. If the algorithm finds a different common
     * parent, we get multiple inserts */
    /* TODO merge options (auto/manual/...) */
    mergeWithRevision: function(otherRevObj) {
        var lthis = this;
        return this.getHeadRevision().pipe(function(headRev) {
            return headRev.createMergedRevision(otherRevObj).pipe(function(newRevObj) {
                return lthis._updateToRevision(newRevObj);
            });
        });
    },
    setLocalSeq: function(syncTarget, seq) {
        return this._save(function(dbObj) {
            var s = dbObj.syncWith[syncTarget] || 0;
            dbObj.syncWith[syncTarget] = Math.max(s, seq);
            return dbObj;
        });
    }
});
/* static */
Note.create = function(text) {
    /* first create the note to obtain an ID, then save the initial revision */
    return (new Note())._save().pipe(function(n) {
        return n.setText(text, null, null, 'create', []);
    });
}
Note.createWithExistingRevision = function(id, revObj, syncTarget) {
    return (new Note())._save(function(dbObj) {
        if ('_rev' in dbObj) {
            /* note was already there */
            throw new Error("Note already exists.");
        } else {
            dbObj._id = id;
            dbObj.headRev = revObj.getID();
            dbObj.title = revObj.getTitle();
            dbObj.syncWith[syncTarget] = 0;
            return dbObj;
        }
    });
}

var NoteRevision = DBObject.extend({
    _init: function(id) {
        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'noteRevision';
            this._dbObj.note = null;
            this._dbObj.date = null;
            this._dbObj.author = null;
            this._dbObj.revType = null;
            this._dbObj.parents = null;
            this._dbObj.text = null;
        }
    },
    setDBObj: function(dbObj) {
        /* XXX check for sorted parents
         * XXX check for hash */
        if (dbObj.type === 'noteRevision' && typeof(dbObj.note) === 'string' &&
                    'date' in dbObj && 'author' in dbObj && typeof(dbObj.revType) === 'string' &&
                    $.isArray(dbObj.parents) && typeof(dbObj.text) == 'string') {
            this._super(dbObj);
        } else {
            throw new Error("Invalid note revision object from database.");
        }
    },
    getDBObject: function() {
        /* XXX copy? perhaps too expensive */
        return this._dbObj;
    },
    getNoteID: function() {
        return this._dbObj.note;
    },
    getText: function() {
        return this._dbObj.text;
    },
    getParents: function() {
        return this._dbObj.parents; /* TODO copy? perhaps too expensive */
    },
    getTitle: function() {
        /* TODO improve this */
        var text = this.getText();
        if (!text) return "Note";
        var m = text.match(/^\s*#(.+)/);
        if (m) {
            return m[1].trim();
        } else {
            return "Note";
        }
    },
    /* TODO revType, date, author? */
    createMergedRevision: function(otherRev) {
        var lthis = this;
        return this._findCommonAncestor(otherRev).pipe(function(parentId) {
            if (parentId === lthis.getID()) return otherRev;
            if (parentId === otherRev.getID()) return lthis;
            return (new NoteRevision(parentId)).getConstructorPromise().pipe(function(parentRev) {
                var textA = lthis.getText();
                var textB = otherRev.getText();
                var textParent = parentRev.getText();
                var m;
                if (lthis.getID() < otherRev.getID()) {
                    /* order is important,
                     * XXX it would be better to use global order and create
                     * planar revision graph */
                    m = new Merge(textParent, textA, textB);
                } else {
                    m = new Merge(textParent, textB, textA);
                }
                var textMerged = m.getMergedText();
                return (new NoteRevision()).save(lthis.getNoteID(), textMerged, null, null,
                                                 "auto merge", [lthis.getID(), otherRev.getID()]);
            });
        });
    },
    _findCommonAncestor: function(otherRev) {
        /* first try it directly using the parent IDs we already have */
        var idA = this.getID();
        var idB = otherRev.getID();
        if (idA === idB)
            return $.when(idA);

        var pA = this.getParents();
        var pB = otherRev.getParents();
        if ($.inArray(idA, pB) >= 0)
            return $.when(idA);
        if ($.inArray(idB, pA) >= 0)
            return $.when(idB);

        for (var i = 0; i < pA.length; i ++)
            for (var j = 0; j < pB.length; j ++)
                if (pA[i] === pB[j])
                    return $.when(pA[i]);

        /* now hand it over to the professionals */
        return FindCommonAncestor(this.getNoteID(), this.getID(), otherRev.getID());
    },
    save: function(noteID, text, author, date, revType, parents) {
        return this._save(function(dbObj) {
            if ('_id' in dbObj || '_rev' in dbObj)
                throw new Error("Only new revisions can be saved.");
            dbObj.type = "noteRevision",
            dbObj.note = noteID,
            dbObj.date = date,
            dbObj.author = author,
            dbObj.revType = revType,
            dbObj.parents = parents.sort(),
            dbObj.text = text
            /* TODO enforce normal form (encoding, etc) */
            dbObj._id = 'rev-' + MD5.hex_md5(JSON.stringify(dbObj));
            return dbObj;
        });
    }
});


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

/* TODO remote could also be arbitrary local or remote directory:
 * save revisions as file with name <id> and additionally a zero-length file <x>-<id>,
 * where x is a number that gets incremented by each save. 
 * */
function RemoteCouchDB(url) {
    this._url = url;

    this._ajaxOpts = {type: 'GET',
                    contentType: 'application/json',
                    accept: 'application/json',
                    dataType: 'json',
                    cache: !$.browser.msie};
}
RemoteCouchDB.prototype.changedDocuments = function(since) {
    /* XXX for testing */
    since = 0;
    return $.ajax($.extend(this._ajaxOpts, {
                        url: this._url + '/_changes',
                        data: {since: since}}))
        .pipe(null, function(req, error) {
            return "Error retrieving remote changed documents: " + error;
        });
}
RemoteCouchDB.prototype.getDocs = function(ids) {
    return $.ajax($.extend(this._ajaxOpts, {
                        type: 'POST',
                        url: this._url + '/_all_docs?include_docs=true',
                        processData: false,
                        data: JSON.stringify({keys: ids})}))
        .pipe(function(res) {
            var objs = {};
            res.rows.forEach(function(row) {
                objs[row.doc._id] = row.doc;
            });
            return objs;
        }, function(req, error) {
            return "Error retrieving remote documents: " + error;
        });
}
RemoteCouchDB.prototype.bulkSave = function(docs) {
    /* TODO do we have to remove the _rev field? */
    return $.ajax($.extend(this._ajaxOpts, {
                        type: 'POST',
                        url: this._url + '/_bulk_docs',
                        processData: false,
                        data: JSON.stringify({docs: docs})}))
        .pipe(function(res) {
            /* TODO what to return? */
            return res;
        }, function(req, error) {
            return "Error saving documents to remote server: " + error;
        });
}


/* XXX this is a db object */
var SyncTarget = DBObject.extend({
    _init: function(id) {
        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'syncTarget';
            this._dbObj.name = null;
            this._dbObj.url = null;
            this._dbObj.remoteSeq = 0;
        }
    },
    setDBObj: function(dbObj) {
        if (dbObj.type === 'syncTarget' && typeof(dbObj.name) === 'string' &&
                    typeof(dbObj.url) === 'string' && 'remoteSeq' in dbObj) {
            this._super(dbObj);
        } else {
            throw new Error("Invalid sync target object from database.");
        }
    },
    getName: function() {
        return this._dbObj.name;
    },
    getURL: function() {
        return this._dbObj.url;
    },
    getRemoteSeq: function() {
        return this._dbObj.remoteSeq
    },
    doSync: function() {
        var lthis = this;

        /* TODO different remote types */
        var remoteDB = new RemoteCouchDB(this.getURL());

        /* TODO reformat the error */

        console.log("Requesting changes since " + this.getRemoteSeq());
        return remoteDB.changedDocuments(this.getRemoteSeq()).pipe(function(remoteChanges) {
            /* TODO make this robust, catch exceptions and report them */
            var objs = new ObjectBag();
            var objsInOrder = [];
            remoteChanges.results.forEach(function(change) {
                var id = change.id;
                if (!change.deleted) /* ignore deletes */
                    objs.insert(1, id);
            });

            /* XXX actually we should ask for the ids that are not missing... */
            return dbInterface.determineAvailableNoteRevisions(objs.idList()).pipe(function(availableObjs) {
                var objectsToFetch = [];
                for (var i = 0; i < remoteChanges.results.length; i ++) {
                    var id = remoteChanges.results[i].id;
                    if (!(id in availableObjs))
                        objectsToFetch.push(id);
                }
                return lthis._fetchRevisions(remoteDB, objectsToFetch, remoteChanges.last_seq);
            });
        });
    },
    _fetchRevisions: function(remoteDB, ids, lastSeq) {
        var lthis = this;
        /* TODO fetch them in batches */
        return remoteDB.getDocs(ids).pipe(function(objs) {
            var remoteObjects = new ObjectBag();
            var occuringParents = new ObjectBag();
            for (var i = 0; i < ids.length; i ++) {
                if (!(ids[i] in objs)) continue;
                var o;
                try {
                    o = new NoteRevision(objs[ids[i]]);
                } catch(e) {
                    continue;
                }
                remoteObjects.insert(o);
                o.getParents().forEach(function(p) { occuringParents.insert(1, p); });
            }
            return dbInterface.determineAvailableNoteRevisions(occuringParents.idList()).pipe(function(availableParents) {
                    var checkedObjects = new ObjectBag();
                    function objectAndParentsExist(id) {
                        if (checkedObjects.hasID(id) || id in availableParents) return true;
                        var obj = remoteObjects.get(id);
                        if (obj === undefined) return false;
                        if (obj.getParents().some(function(pID) { return !objectAndParentsExist(pID); }))
                            return false;
                        checkedObjects.insert(obj);
                        return true;
                    }

                    remoteObjects.each(function(id, o) { 
                        if (!objectAndParentsExist(id)) {
                            /* XXX some error */
                            console.log("Parent missing: " + id);
                        }
                    });

                    /* XXX check if someone added a new root - is it really bad?
                     * we could modify the code to cope with multiple roots */

                    console.log("Valid objects: " + checkedObjects.idList().length);
                    var docList = checkedObjects.map(function(o) { return o.getDBObject(); });
                    return dbInterface.saveDocs(docList).pipe(function(res) {
                            console.log(res);
                            /* TODO handle conflicts and save errors,
                             * update the objects? */

                            var nonHeadRevisions = {};
                            checkedObjects.each(function(id, o) {
                                o.getParents().forEach(function(pID) {
                                    nonHeadRevisions[pID] = 1;
                                });
                            });
                            var headRevisions = {};
                            checkedObjects.each(function(id, o) {
                                if (id in nonHeadRevisions)
                                    return;
                                var noteID = o.getNoteID();
                                if (!(noteID in headRevisions))
                                    headRevisions[noteID] = [];
                                headRevisions[noteID].push(o);
                            });


                            /* TODO really do this in parallel? */
                            var processes = $.map(headRevisions, function(revisions, noteID) {
                                return lthis._mergeHeadsAndUpdateDocuments(noteID, revisions);
                            });
                            processes.push(lthis._setRemoteSeq(lastSeq));
                            return DeferredSynchronizer(processes).pipe(function() {
                                /* XXX errors? */
                                return lthis._pushRevisions(checkedObjects);
                            });
                        });
                });
        });
    },
    _mergeHeadsAndUpdateDocuments: function(noteID, headRevisions) {
        var lthis = this;
        /* XXX for debugging */
        var merge = true;
        if (merge) {
            var lthis = this;
            if (headRevisions.length > 1) {
                /* TODO merge the revisions that are "close" */
                return headRevisions[0].createMergedRevision(headRevisions[1]).pipe(function(newRevObj) {
                    var newHeads = headRevisions.splice(2);
                    newHeads.push(newRevObj);
                    return lthis._mergeHeadsAndUpdateDocuments(noteID, newHeads);
                });
            }
        }
        return (new Note(noteID)).getConstructorPromise().pipe(function(note) {
            if (!merge) return 1;
            if (note.getLocalSeq(lthis.getID()) === undefined) return 1;
            return note.mergeWithRevision(headRevisions[0]);
        }, function() {
            console.log("Creating: " + noteID);
            return Note.createWithExistingRevision(noteID, headRevisions[0], lthis.getID());
        });
    },
    _pushRevisions: function(revsToIgnore) {
        var lthis = this;
        console.log("Pushing objects to remote server.");
        return dbInterface.getNotesToSync(this.getID()).pipe(function(notes) {
            var revisionObjects = [];
            /* TODO really parallel? */
            console.log("Sync notes: " + notes.length);
            var processes = $.map(notes, function(note) {
                var id = note.getID();
                var seq = note.getLocalSeq(lthis.getID());
                return dbInterface.changedRevisions(id, seq).pipe(function(res) {
                    res.revisions.forEach(function(rev) {
                        if (!revsToIgnore.hasID(rev._id))
                            revisionObjects.push(rev);
                    });
                    return note.setLocalSeq(lthis.getID(), res.lastSeq);
                });
            });
            return DeferredSynchronizer(processes).pipe(function() {
                var remoteDB = new RemoteCouchDB(lthis.getURL());
                console.log("Objs to push: " + revisionObjects.length);
                /* TODO we could have errors in some processes */
                return remoteDB.bulkSave(revisionObjects);
            });
        });
    },
    _setRemoteSeq: function(remoteSeq) {
        return this._save(function(dbObj) {
            var s = dbObj.remoteSeq || 0;
            dbObj.remoteSeq = Math.max(s, remoteSeq);
            return dbObj;
        });
    },
    save: function(name, url) {
        return this._save(function(dbObj) {
            if ('_id' in dbObj || '_rev' in dbObj)
                throw new Error("Only new sync targets can be saved.");
            dbObj.type = "syncTarget";
            dbObj.name = name;
            dbObj.url = url;
            dbObj.remoteSeq = 0;
            return dbObj;
        });
    }
});
SyncTarget.create = function(name, url) {
    return (new SyncTarget()).save(name, url);
}

noteBrowser = new NoteBrowser();
dbInterface = new DBInterface();

});
