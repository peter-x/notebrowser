/* XXX aw, globals! use some module loader */
var noteBrowser;
var dbInterface;
$(function() {
"use strict";


function NoteBrowser() {
    this.currentNoteID = new LiveValue(null);

    this._noteViewer = new NoteViewer();

    /* XXX objects in here should not be change.
     * enforce that by setting them to "constant"? */
    this._notesByID = null;
    this._notesByTitle = null;
    this._notesByTag = null;
    this._notesBySyncTarget = null;

    var lthis = this;
    this._changeListener = null;

    window.setTimeout(function() {
        lthis._changeListener = dbInterface.on('change', function(doc) {
            if (doc.type && doc.type === 'syncTarget') {
                lthis._updateSyncTargetButton(new SyncTarget(doc));
            } else if (doc.type && doc.type === 'note') {
                lthis._removeNote(doc._id);
                lthis._insertNote(new Note(doc));
            }
        });
        dbInterface.on('ready', function() {
            dbInterface.getAllNotes()
                .done(function(notes) {
                    lthis._notesByID = {};
                    lthis._notesByTitle = {};
                    lthis._notesByTag = {};
                    lthis._notesBySyncTarget = {};
                    notes.forEach(function(note) { lthis._insertNote(note); });

                    lthis._noteList = new NoteList();
                    lthis._syncTargetList = new SyncTargetList();

                    lthis._init();
                })
                .fail(function(err) {
                    noteBrowser.showError(err);
                });
        });
    }, 10);
}
NoteBrowser.prototype.destroy = function() {
    if (this._changeListener !== null) {
        dbInterface.off('change', this._changeListener);
        this._changeListener = null;
    }
}
NoteBrowser.prototype._insertNote = function(note) {
    var lthis = this;
    var id = note.getID();
    var title = note.getTitle();

    this._notesByID[id] = note;
    if (!(title in this._notesByTitle))
        this._notesByTitle[title] = {};
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
NoteBrowser.prototype._removeNote = function(id) {
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
    delete this._notesByTitle[note.getTitle()][id];
    delete this._notesByID[id];
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
        var note = lthis.getNoteByID(hash) || lthis.getFirstNoteByTitle(hash);
        if (note === undefined) {
            document.location.hash = '#' + lthis.currentNoteID.get();
            noteBrowser.showError("Note " + hash + " not found.");
            return false;
        }
        lthis._showNote(note.getID());
    }

    $(window).on('hashchange', checkHash);
    checkHash();

    this._updateSyncTargetButtons();

    $('#newNoteButton').click(function() {
        Note.create('# New Note\n')
            .fail(function(err) { lthis.showError(err); })
            .done(function(note) {
                lthis._noteViewer.showEditNote(note);
                lthis.currentNoteID.set(note.getID());
                $('#noteNavigation').addClass('hidden-phone');
                $('#noteArea').show();
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
    $('#showNoteNavigationButton').click(function() {
        lthis.currentNoteID.set(null);
        lthis._noteViewer.closeNote();
        $('#noteNavigation').removeClass('hidden-phone');
        $('#noteArea').hide();
    });
}
NoteBrowser.prototype.showError = function(message) {
    $('<div class="alert alert-error"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
        .append($('<p/>')
            .text(String(message)))
        .alert()
        .appendTo('#messageArea');
}
NoteBrowser.prototype.showInfo = function(message, box) {
    if (box === undefined)
        box = $('<div class="alert alert-info"><a class="close" data-dismiss="alert" href="#">&times;</a></div>')
            .alert()
            .appendTo('#messageArea');
    return box.append($('<p/>')
            .text(String(message)));
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
    target = target.copy();
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
NoteBrowser.prototype.getNoteByID = function(id) {
    return this._notesByID[id];
}
NoteBrowser.prototype.getFirstNoteByTitle = function(title) {
    var notes = this._notesByTitle[title];
    if (notes === undefined) return undefined;
    for (var id in notes) {
        return this._notesByID[id];
    }
    return undefined;
}
NoteBrowser.prototype.getNoteByTitle = function(title) {
    return this._notesByTitle[title] || {};
}
NoteBrowser.prototype.getNotesByTag = function(tag) {
    return this._notesByTag[tag] || {};
}
NoteBrowser.prototype.getNotesBySyncTarget = function(syncTargetID) {
    return this._notesBySyncTarget[syncTargetID] || {};
}
NoteBrowser.prototype.getAllNotes = function() {
    return this._notesByID; /* XXX copy? */
}
NoteBrowser.prototype._showNote = function(id) {
    if (!(id in this._notesByID)) {
        noteBrowser.showError("Note not found.");
        return;
    }
    this.currentNoteID.set(id);
    /* XXX give noteViewer a chance to ask the user if the current note should
     * be closed */
    this._noteViewer.showNote(this.getNoteByID(id));
    $('#noteNavigation').addClass('hidden-phone');
    $('#noteArea').show();
}

function NoteViewer() {
    this._note = null;
    this._revision = undefined;

    this._editMode = false;

    this._container = null;
    this._buttonEdit = null;
    this._buttonSave = null;
    this._buttonCancel = null;

    this._revisionGraphArea = null;
    this._syncTableArea = null;
    this._editArea = null;
    this._viewArea = null;
    this._viewAreaTags = null;
    this._viewAreaSubtags = null;
    this._viewAreaText = null;

    this._showdown = new Showdown.converter();

    this._syncTable = null;
    this._revisionGraph = null;

    this._findUIElements();

    this._noteText = '';
    this._noteTags = [];
    this._landRenderDuration = 500;
    this._lastRawText = '';
    this._renderTimer = null;

    var lthis = this;
    this._changeListener = null;
    window.setTimeout(function() {
        lthis._installChangeListener();
    }, 10);
}
NoteViewer.prototype.destroy = function() {
    if (this._revisionGraph !== null) {
        this._revisionGraph.destroy();
        this._revisionGraph = null;
    }
    /* XXX remove all the handlers */
    dbInterface.off('change', this._changeListener);
}
NoteViewer.prototype._installChangeListener = function() {
    var lthis = this;
    if (this._changeListener === null) {
        this._changeListener = dbInterface.on('change', function(doc) {
            if (lthis._note === null) return;
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
NoteViewer.prototype._findUIElements = function() {
    var lthis = this;

    this._buttonEdit = $('#viewEditButton')
        .click(function() { lthis._toEditMode(); });
    this._buttonCancel = $('#viewCancelButton')
        .click(function() { lthis._cancelChanges(); });
    this._buttonSave = $('#viewSaveButton')
        .click(function() { lthis._saveChanges(); });
    $('#viewRevisionGraphButton')
        .click(function() { lthis._toggleRevisionGraph(); });
    $('#viewSyncTargetsButton')
        .click(function() { lthis._toggleSyncTargets(); });

    this._revisionGraphArea = $('#revisionGraphArea')
        .hide();

    this._syncTableArea = $('#syncTableArea')
        .hide();

    this._editArea = $('#editArea');
    this._viewArea = $('#viewArea');
    this._viewAreaTags = $('#viewAreaTags');
    this._viewAreaSubtags = $('#viewAreaSubtags');
    this._viewAreaText = $('#viewAreaText');

    $('#editTags').keyup(function() { lthis._tagsTextChanged(); });
    $('textarea', this._editArea).keyup(function() { lthis._textChanged(); });
    window.setInterval(function() {
        if (lthis._editMode && $('textarea', lthis._editArea).val() !== lthis._lastRawText)
            lthis._textChanged();
    }, 1000);
}
NoteViewer.prototype._textChanged = function() {
    if (!this._editMode)
        return;

    if (this._renderTimer) {
        window.clearTimeout(this._renderTimer);
        this._renderTimer = null;
    }

    var lthis = this;
    this._renderTimer = window.setTimeout(function() { lthis._doRender(true); },
                      Math.min(2.0 * this._lastRenderDuration, 2000));
}
NoteViewer.prototype._tagsTextChanged = function() {
    if (!this._editMode)
        return;

    this._doRenderTags();
}
NoteViewer.prototype._getTagsFromInput = function() {
    var tags = [];
    $('#editTags').val().split(',').forEach(function(tag) {
        tag = tag.trim();
        if (tag === '')
            return;
        if (noteBrowser.getNoteByID(tag) !== undefined) {
            tags.push(tag);
        } else {
            var note = noteBrowser.getFirstNoteByTitle(tag);
            tags.push(note !== undefined ? note.getID() : tag);
        }
    });
    return tags;
}
NoteViewer.prototype._doRenderTags = function() {
    /* XXX listen on changes to these notes? */
    var tagArea = $('#viewAreaTags').empty();
    var tags;
    if (this._editMode) {
        tags = this._getTagsFromInput();
    } else {
        tags = this._noteTags;
    }
    var first = true;
    tags.forEach(function(tag) {
        if (!first)
            tagArea.append(', ');
        first = false;
        var note = noteBrowser.getNoteByID(tag);
        if (note === undefined) {
            tagArea.append($('<span></span>').text(tag));
        } else {
            tagArea.append($('<a></a>', {href: '#' + note.getID()}).text(note.getTitle()));
        }
    });
}
NoteViewer.prototype._doRenderSubtags = function() {
    /* XXX listen on changes to these notes? */
    var tagArea = $('#viewAreaSubtags').empty();

    function renderRec(tag, target, parents) {
        var notes = $.map(noteBrowser.getNotesByTag(tag), function(note) { return note; });
        if (notes.length === 0) return;

        parents[tag] = 1;
        var ul = $('<ul></ul>');
        notes.sort(function(a, b) { return a.getTitle() < b.getTitle(); })
            .forEach(function(note) {
                var id = note.getID();
                var title = note.getTitle();
                var li = $('<li></li>')
                    .append($('<a></a>', {href: '#' + id}) .text(title));
                if (id in parents) {
                    $('<ul><li>(loop)</li></ul>').appendTo(li);
                } else {
                    renderRec(id, li, parents);
                }
                li.appendTo(ul);
            });
        ul.appendTo(target);
        delete parents[tag];
    }
    renderRec(this._note.getID(), tagArea, {});
}
NoteViewer.prototype._doRender = function(math) {
    this._renderTimer = null;

    var start = (new Date()) - 0;

    var text;
    if (this._editMode) {
        text = $('textarea', this._editArea).val();
    } else {
        text = this._noteText;
    }
    this._lastRawText = text;

    this._viewAreaText
        .empty()
        .append(this._showdown.makeHtml(text));
    if (math && MathJax)
        MathJax.Hub.Queue(["Typeset", MathJax.Hub, this._viewAreaText[0]]);

    this._lastRenderDuration = (new Date()) - start;
}
NoteViewer.prototype.closeNote = function() {
    this._note = null;
    this._revision = null;
    this._revisionGraph = null;
}
NoteViewer.prototype.showNote = function(note, revision) {
    var noteChange = !this._note || this._note.getID() !== note.getID();
    this._note = note.copy();
    this._revision = revision;
    if (this._revisionGraph !== null)
        this._revisionGraph.setCurrentRevision(revision === undefined ? this._note.getHeadRevisionID() : revision,
                                               noteChange ? note : undefined);
    this._updateSyncTable();
    this._toViewMode();
}
NoteViewer.prototype.showEditNote = function(note, revision) {
    var noteChange = !this._note || this._note.getID() !== note.getID();
    /* XXX clear the view areas (they can contain an old note) */
    this._note = note.copy();
    this._revision = revision;
    if (this._revisionGraph !== null)
        this._revisionGraph.setCurrentRevision(revision === undefined ? this._note.getHeadRevisionID() : revision,
                                               noteChange ? note : undefined);
    this._updateSyncTable();
    this._toEditMode();
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
    this._note.getRevision(this._revision)
        .done(function(rev) {
            var text = (rev === null ? '' : rev.getText());
            var tags = (rev === null ? [] : rev.getTags());

            lthis._doRenderTags();
            lthis._doRenderSubtags();
            lthis._doRender(true);

            lthis._editMode = true;
            lthis._buttonEdit.hide();
            lthis._buttonSave.show();
            lthis._buttonCancel.show();
            lthis._viewArea
                .removeClass('span9')
                .addClass('span4');
            lthis._editArea.show();
            $('textarea', lthis._editArea)
                .val(text)
                .focus();
            $('#editTags').val(tags.join(', '));
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });
}
NoteViewer.prototype._toViewMode = function() {
    var lthis = this;
    /* XXX progress indicator */
    this._note.getRevision(this._revision)
        .done(function(rev) {
            var text = (rev === null ? '' : rev.getText());
            var tags = (rev === null ? [] : rev.getTags());

            lthis._editMode = false;
            lthis._noteText = text;
            lthis._noteTags = tags;

            lthis._buttonEdit.show();
            lthis._buttonSave.hide();
            lthis._buttonCancel.hide();

            lthis._doRenderTags();
            lthis._doRenderSubtags();
            lthis._doRender(true);

            lthis._viewArea
                .removeClass('span4')
                .addClass('span9');
            lthis._editArea.hide();
        })
        .fail(function(err) {
            noteBrowser.showError(err);
        });

}
NoteViewer.prototype._updateSyncTable = function() {
    var lthis = this;
    this._syncTableArea.empty();
    /* XXX store them in NoteBrowser */
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
            lthis._syncTableArea.empty();
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
    var text = $('textarea', this._editArea).val();
    var tags = this._getTagsFromInput();

    var lthis = this;
    /* XXX if we are viewing an old revision, then mark it as manual
     * merge and adjust the parents appropriately. */
    this._note.setText(text, tags)
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
NoteViewer.prototype._toggleSyncTargets = function() {
    this._syncTableArea.toggle('slow');
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
        .fail(function(err) { noteBrowser.showError("Error loading revisions: " + err); })
        .done(function(revs, updateSeq) {
            lthis._revisions = revs;
            lthis._updateHierarchy();
            /* XXX is it safe to draw now? (the width is not yet fixed) */
            lthis.redraw();
        });
}
RevisionGraph.prototype._getRoots = function() {
    var roots = [];
    $.each(this._revisions, function(id, rev) {
        if (rev.parents.length === 0)
            roots.push(id);
    });
    return roots;
}
RevisionGraph.prototype._getChildrenMap = function() {
    var children = {};
    for (var id in this._revisions)
        children[id] = [];
    for (var id in this._revisions) {
        this._revisions[id].parents.forEach(function(p) {
            if (p in children)
                children[p].push(id);
        });
    }
    return children;
}
RevisionGraph.prototype._updateHierarchy = function() {
    var root = this._getRoots();
    var children = this._getChildrenMap();

    this._revisionPositions = {};
    var queue = {};
    this._getRoots().forEach(function(root) { queue[root] = 1; });
    var x = 0;
    var cont = true;
    var maxColumn = 0;

    /* XXX detect loops */
    while (cont && x < 100) {
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
                        '<b>Tags:</b> <span class="tags"> </span><br/>' +
                        '<b>Type:</b> <span class="revType"> </span></p>');
        if (rid in lthis._revisions) {
            var r = lthis._revisions[rid];
            var tags = (r.tags || []).map(function(noteID) {
                var n = noteBrowser.getNoteByID(noteID);
                return n ? n.getTitle() : noteID;
            });
            var shortenID = function(id) { return (id || '').replace(/.*\//, ''); }
            $('.date', content).text(r.date);
            $('.author', content).text(r.author);
            $('.revType', content).text(r.revType);
            $('.parents', content).text(r.parents.map(shortenID).join(', '));
            $('.tags', content).text(tags.join(', '));
            $('.title', content).text(shortenID(r._id));
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
RevisionGraph.prototype.setCurrentRevision = function(revision, note) {
    this._currentRevision = revision;
    if (note) {
        this._note = note;
        this._update();
    } else {
        this.redraw();
    }
}

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
PouchDB.prototype.getAllNotes = function() {
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

function CouchDB(path, remote) {
    this._path = path;
    this._remote = remote;
    this._db = null;
    this._dbName = null;

    this._init();
}
CouchDB.prototype._init = function() {
    var lthis = this;
    if (this._path) {
        var m = this._path.match(/(.*)\/([^\/]+)\/?/);
        if (!m) {
            /* XXX Where to show the error? Depends on if we are remote or not. */
            return;
        }
        $.couch.urlPrefix = m[1];
        this._dbName = m[2];
    } else {
        $.couch.urlPrefix = '';
        lthis._dbName = unescape(document.location.href).split('/')[3];
    }
    var db = $.couch.db(this._dbName);
    if (!this._remote) {
        window.setTimeout(function() {
            db.info({success: function(res) {
                lthis._db = db;
                lthis._registerChangesFeed(res.update_seq);
                lthis._trigger('ready');
            }});
        }, 10);
    }
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
    /* XXX can we use couch.allDocs()? */
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
            return "Error determining objects available on local server: " + error;
        });
}
CouchDB.prototype.getAllNotes = function() {
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
CouchDB.prototype.getDocs = function(ids) {
    if (!this._db)
        return $.Deferred().reject("Not connected to database.").promise();

    /* XXX optimize that */
    var lthis = this;
    return DeferredSynchronizer($.map(ids, function(id) {
        return lthis._getDoc(id);
    }));
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
/* XXX make this work for multiple noteIDs (change the filter) */
CouchDB.prototype.changedRevisions = function(noteID, since) {
    var ajaxOpts = {type: 'GET',
                    dataType: 'json',
                    accept: 'application/json',
                    cache: !$.browser.msie};
    return $.ajax($.extend(ajaxOpts, {
                        url: '/' + this._dbName + '/_changes',
                        data: {filter: 'default/noteRevisions',
                            note: noteID,
                            include_docs: false,
                            since: since}}))
        .pipe(function(res) {
            return {lastSeq: res.last_seq,
                    revisions: $.map(res.results, function(r) {
                        /* TODO */
                        return r.doc._id;
                    })};
        }, function(req, error) {
            return "Error determining changed revisions on local serer: " + error;
        });
}
CouchDB.prototype.saveRevisions = function(docs) {
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

function LocalFileSystemDB(path, remote) {
    this._path = path || this._pathFromDocumentLocation();
    this._fs = null;
    this._remote = remote;

    this._changeInterval = null;
    this._initialized = false;
    this._lastChangeSeq = 0;
    this._changeSeqsToIgnore = {};

    this._suppressedChangeLogEntries = [[], []];

    this._fs = LocalFileInterface;

    if (remote) {
        this._initialized = true;
    } else {
        var lthis = this;
        window.setTimeout(function() {
            lthis._initMergeService();
            lthis._initChangeListener();
        }, 10);
    }
}
LocalFileSystemDB.prototype._pathFromDocumentLocation = function() {
    var path = unescape(document.location.pathname);
    var i = path.lastIndexOf('/');
    if (i < 0) {
        return path;
    } else {
        return path.substr(0, i);
    }
}
/* XXX remove changeInterval on destruction */
LocalFileSystemDB.prototype._initChangeListener = function() {
    var lthis = this;

    function checkForChanges() {
        /* XXX avoid duplicate change notifications */
        var i = lthis._lastChangeSeq + 1;
        lthis._fs.exists(lthis._path + '/data/changes/' + i).done(function(ex) {
            /* XXX what if it exists but is still empty? */
            if (!ex) return;
            lthis._lastChangeSeq = Math.max(lthis._lastChangeSeq, i);
            if (lthis._changeSeqsToIgnore[i]) {
                delete lthis._changeSeqsToIgnore[i];
                return;
            }
            lthis._readJSON('data/changes/' + i).done(function(change) {
                change.changes.forEach(function(path) {
                    lthis._readJSON(path).done(function(doc) {
                        lthis._trigger('change', doc);
                    });
                });
            });
        });

    }
    lthis._listDir('data/changes').pipe(function(files) {
        var largest = 0;
        files.forEach(function(f) {
            if (f !== 'lock' && f - 0 > largest)
                largest = f - 0;
        });
        lthis._lastChangeSeq = largest;
        lthis._changeInterval = window.setInterval(checkForChanges, 1000);
        lthis._initialized = true;
        lthis._trigger('ready');
    }, function(err) {
        noteBrowser.showError("Error initializing database: " + err);
    });
}
LocalFileSystemDB.prototype._initMergeService = function() {
    var lthis = this;
    var dataFile = 'data_local/remoteChangesMergedUntil';
    var runningMyself = false;
    var mergeChanges = function() {
        if (runningMyself) return;
        runningMyself = true;
        lthis._acquireLock(dataFile).pipe(function() {
            lthis._readJSON(dataFile)
                .pipe(function(data) { return mergeAfter(data || 0); },
                      function() { return mergeAfter(0); })
                .done(function() {
                    lthis._releaseLock(dataFile);
                    runningMyself = false;
                });
        });
    }
    var mergeAfter = function(seq) {
        return lthis.changedRevisions(null, seq, true).pipe(function(res) {
            if (res.lastSeq === seq)
                return;
            return lthis.getDocs(res.revisions).pipe(function(revData) {
                if (revData.length === 0)
                    return;
                var revisions = [];
                revData.forEach(function(o) {
                    try {
                        o = new NoteRevision(o);
                    } catch(e) {
                        return;
                    }
                    revisions.push(o);
                });
                var headRevisions = NoteRevision.determineHeadRevisions(revisions);
                return DeferredSynchronizer($.map(headRevisions, function(revisions, noteID) {
                    /* TODO merge these in one change file */
                    return Note.mergeHeadsAndUpdate(noteID, revisions);
                })).pipe(function() {
                    return lthis._fs.write(lthis._path + '/' + dataFile, '' + res.lastSeq);
                });
            });
        });
    }

    /* XXX use a flag that indicates if the change was a remote change, then the
     * change file is read only once */
    this.on('change', mergeChanges);
    this.on('ready', mergeChanges);
}
LocalFileSystemDB.prototype.determineAvailableNoteRevisions = function(keys) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var available = {};
    return DeferredSynchronizer(keys.map(function(key) {
        /* XXX sanity check for key */
        return lthis._fs.exists(lthis._path + '/data/notes/' + key).pipe(function(res) {
                if (res) available[key] = 1;
            });
    })).pipe(function() {
        return available;
    });
}
LocalFileSystemDB.prototype.getAllNotes = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    return this._readJSONFilesInDir('data_local/notes').pipe(function(objs) {
        var notes = [];
        objs.forEach(function(o) {
            try {
                notes.push(new Note(o));
            } catch (e) {
                /* XXX */
            }
        });
        return notes;
    });
}
LocalFileSystemDB.prototype.getAllSyncTargets = function() {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();
    
    var lthis = this;
    var path = this._path;
    return this._readJSONFilesInDir('data_local/syncTargets').pipe(function(objs) {
        var targets = [];
        objs.forEach(function(o) {
            try {
                targets.push(new SyncTarget(o));
            } catch (e) {
                /* XXX */
            }
        });
        return targets;
    });
}
LocalFileSystemDB.prototype._readJSONFilesInDir = function(dir, noCreate) {
    var lthis = this;
    return this._listDir(dir, noCreate).pipe(function(files) {
        var processes = [];
        files.forEach(function(f) {
            if (!f.match('\.lock$'))
                processes.push(lthis._readJSON(dir + '/' + f));
        });
        return DeferredSynchronizer(processes);
    });
}
LocalFileSystemDB.prototype._readJSON = function(path) {
    return this._fs.read(this._path + '/' + path).pipe(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return $.Deferred().reject("JSON error: " + e.message).promise();
        }
    });
}
LocalFileSystemDB.prototype._listDir = function(dir, noCreate) {
    return this._fs.list(this._path + '/' + dir, !noCreate);
}
LocalFileSystemDB.prototype.getDoc = function(id) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    return this._getDoc(id);
}
LocalFileSystemDB.prototype._getDoc = function(id) {
    if (!id.match(/^[a-zA-Z0-9\/]*$/))
        return $.Deferred().reject("Invalid document id.").promise();

    var lthis = this;
    if (id.match(/\//)) {
        return this._readJSON('data/notes/' + id);
    } else {
        return this._readJSON('data_local/notes/' + id).pipe(null,
            function(err) {
                return lthis._readJSON('data_local/syncTargets/' + id);
            });
    }
}
LocalFileSystemDB.prototype.getDocs = function(ids) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    return DeferredSynchronizer($.map(ids, function(id) {
        return lthis._getDoc(id);
    }));
}
LocalFileSystemDB.prototype.getRevisionMetadata = function(noteID) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var path = this._path;
    return this._readJSONFilesInDir('data/notes/' + noteID, true).pipe(function(objList) {
        var objs = {};
        objList.forEach(function(o) {
            delete o.text;
            objs[o._id] = o;
        });
        return objs;
    });
}
/* noteID can be: note also works for an array of noteIDs
 * and even for a noteID -> seqID mapping */
LocalFileSystemDB.prototype.changedRevisions = function(noteID, after, onlyRemoteChanges) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    var revs = [];
    var idPrefix = 'data/notes/';
    var matches;
    if (noteID === null) {
        matches = function(path) { return path.substr(0, idPrefix.length) === idPrefix; };
    } else if ($.isArray(noteID)) {
        var noteIDs = {};
        noteID.forEach(function(nid) { noteIDs[nid] = 1; });
        matches = function(path) {
            var m = path.match(/data\/notes\/([^\/]*)/);
            return (m && m[1] in noteIDs);
        }
    } else if (typeof(noteID) === 'string') {
        var notePrefix = idPrefix + noteID + '/';
        var prefixLength = notePrefix.length;
        matches = function(path) { return path.substr(0, prefixLength) === noteID; };
    } else {
        /* assume object */
        var after = Math.min.apply(Math, $.map(noteID, function(seq) { return seq; }));
        matches = function(path, seq) {
            var m = path.match(/data\/notes\/([^\/]*)/);
            if (!m) return false;
            var id = m[1];
            return (id in noteID && seq > noteID[id]);
        }
    }

    function getChanges(i) {
        return lthis._readJSON('data/changes/' + i).pipe(function(data) {
            if (!onlyRemoteChanges || data.type === 'remote') {
                data.changes.forEach(function(path) {
                    if (matches(path, i))
                        revs.push(path.substr(idPrefix.length));
                });
            }
            return getChanges(i + 1);
        }, function() {
            return $.when({lastSeq: i - 1, revisions: revs});
        });
    }
    
    return getChanges(after + 1);
}
LocalFileSystemDB.prototype._acquireLock = function(path) {
    var lthis = this;
    var maxAge = 4000; /* remove locks older than four seconds */
    var retryTime = 100; /* retry every 100 ms */

    return this._fs.acquireLock(this._path + '/' + path + '.lock').pipe(function(success, age) {
        if (success)
            return true;
        if (age < maxAge) {
            var d = $.Deferred();
            window.setTimeout(function() {
                lthis._acquireLock(path)
                    .done(function() { d.resolve.apply(d, arguments); })
                    .fail(function() { d.reject.apply(d, arguments); });
            }, retryTime);
            return d.promise();
        } else {
            /* XXX message */
            console.log("Forcibly removed lock on " + path);
            return lthis._fs.releaseLock(lthis._path + '/' + path + '.lock').pipe(function() {
                return lthis._acquireLock(path);
            });
        }
    });
}
LocalFileSystemDB.prototype._releaseLock = function(path) {
    /* XXX ignore errors for inexistent locks? */
    return this._fs.releaseLock(this._path + '/' + path + '.lock');
}
LocalFileSystemDB.prototype._getPathForDoc = function(doc) {
    if (doc.type === 'note') {
        return 'data_local/notes/' + doc._id;
    } else if (doc.type === 'noteRevision') {
        return 'data/notes/' + doc._id;
    } else if (doc.type === 'syncTarget') {
        return 'data_local/syncTargets/' + doc._id;
    } else {
        return null;
    }
}
LocalFileSystemDB.prototype._saveDoc = function(doc, options) {
    var lthis = this;
    options = options || {};

    if (!('_id' in doc)) {
        if (doc.type === 'noteRevision') {
            doc._id = doc.note + '/' + this._genID();
        } else {
            doc._id = this._genID();
        }
    }
    if (!options['suppressRevCheck']) {
        if (!('_rev' in doc))
            doc._rev = '0-x';
        doc._rev = this._getIncrementedRev(doc);
    }

    var path = this._getPathForDoc(doc);
    if (path === null) {
        return $.Deferred().reject("Invalid document type.").promise();
    }

    /* XXX also release the lock on errors */

    var data;
    try {
        data = JSON.stringify(doc);
    } catch (e) {
        return $.Deferred().reject("Invalid data in document: " + e.message).promise();
    }
    if (options['suppressLocking']) {
        return this._fs.write(this._path + '/' + path, data).pipe(logChange);
    }
    return this._acquireLock(path).pipe(function() {
        return lthis._readJSON(path).pipe(function(olddoc) {
            if (olddoc._rev === doc._rev) {
                /* no conflict, no save */
                return lthis._releaseLock(path).pipe(function() { return null; });
            } else if (!lthis._olderRev(olddoc._rev, doc._rev)) {
                /* conflict */
                return lthis._releaseLock(path).pipe(function() { return olddoc; });
            } else {
                return writeAndReleaseLock();
            }
        }, function() {
            return writeAndReleaseLock();
        });
    });

    function writeAndReleaseLock() {
        return lthis._fs.write(lthis._path + '/' + path, data).pipe(function() {
            return lthis._releaseLock(path).pipe(logChange);
        });
    }
    function logChange() {
        if (options['suppressChangeLog']) {
            lthis._suppressedChangeLogEntries[0].push(path);
            lthis._suppressedChangeLogEntries[1].push(doc);
            return null;
        }
        return lthis._logChanges([path], [doc]).pipe(function() {
            return null;
        });
    }
}
LocalFileSystemDB.prototype.logSuppressedChanges = function() {
    var changes = this._suppressedChangeLogEntries[0];
    var docs = this._suppressedChangeLogEntries[1];
    this._suppressedChangeLogEntries = [[], []];
    return this._logChanges(changes, docs);
}
LocalFileSystemDB.prototype._logChanges = function(changes, docs) {
    var lthis = this;
    var i = this._lastChangeSeq;

    if (changes.length === 0 && docs.length === 0) {
        return $.when(true);
    }

    function findNextFreeChangeFile(i) {
        return lthis._fs.exists(lthis._path + '/data/changes/' + i).pipe(function(ex) {
            return ex ? findNextFreeChangeFile(i + 1) : i;
        });
    }
    var data = JSON.stringify({type: this._remote ? 'remote' : 'local', changes: changes});
    return this._acquireLock('data/changes').pipe(function() {
        return findNextFreeChangeFile(lthis._lastChangeSeq + 1).pipe(function(i) {
            lthis._changeSeqsToIgnore[i] = 1;
            return lthis._fs.write(lthis._path + '/data/changes/' + i, data).pipe(function() {
                return lthis._releaseLock('data/changes').pipe(function() {
                    if (!lthis._remote) {
                        docs.forEach(function(doc) {
                            lthis._trigger('change', doc);
                        });
                    }
                    return true;
                });
            });

        });
    });
}
LocalFileSystemDB.prototype.saveDoc = function(doc, options) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    return this._saveDoc(doc, options).pipe(function(res) {
        if (res !== null) {
            /* res is conflicting object */
            return $.Deferred().reject("Conflict.", true, res).promise();
        } else {
            return doc;
        }
    });
}
LocalFileSystemDB.prototype.saveRevisions = function(docs) {
    if (!this._initialized)
        return $.Deferred().reject("Not connected to database.").promise();

    var lthis = this;
    return DeferredSynchronizer($.map(docs, function(doc) {
        return lthis._saveDoc(doc, {'suppressChangeLog': true,
                                    'suppressRevCheck': true,
                                    'suppressLocking': true});
    })).pipe(function() {
        return lthis.logSuppressedChanges();
        /* XXX return value and conflicts are currently ignored */
    });
}
LocalFileSystemDB.prototype._genID = function() {
    var id = '';
    for (var i = 0; i < 32; i += 4) {
        var part = Math.floor((Math.random() * 0x10000)).toString(16);
        id += '0000'.substr(part.length) + part.substr(0, 4);
    }
    return id;
}
LocalFileSystemDB.prototype._getIncrementedRev = function(doc) {
    var copy = $.extend(true, {}, doc);
    var num = (copy._rev.split('-')[0] - 0) + 1;
    delete copy._rev;

    /* XXX use some normal form */
    return num + '-' + MD5.hex_md5(JSON.stringify(copy));
}
LocalFileSystemDB.prototype._olderRev = function(reva, revb) {
    var partsa = reva.split('-');
    var partsb = revb.split('-');
    return (partsa[0] - 0 < partsb[0] - 0);
}
addEvents(LocalFileSystemDB, ['ready', 'change']);

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
InMemoryDB.prototype.getAllNotes = function() {
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
            if (noteID === null || r.note === noteID)
                revs.push(id);
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
InMemoryDB.prototype.saveRevisions = function(docs) {
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
    /* XXX detect if another window writes to this file */
    if (this._lastAutoSave == this._changeLog.length)
        return;

    var path = document.location.pathname.replace(/\/index.html$/, '') + '/data.jsonp';
    var data = 'noteBrowserData = ' + this._export() + ';';

    var lthis = this;
    LocalFileInterface.write(path, data)
        .done(function() {
            lthis._lastAutoSave = lthis._changeLog.length;
        })
        .fail(function(err) {
            noteBrowser.showError("Unable to save data to local filesystem: " + err);
            window.clearInterval(lthis._autoSaveInterval);
            lthis._autoSaveInterval = null;
        });
}
addEvents(InMemoryDB, ['ready', 'change']);

var DBInterface = (function() {
    /* XXX better check if couchdb is there */

    var url = document.location.href;
    if (url.match(/file:\/\//)) {
        return LocalFileSystemDB;
    } else if (url.match(/\/_design\//)) {
        return CouchDB;
    } else {
        return InMemoryDB;
    }

})();


function SyncTargetList() {
    this._changeListener = null;

    var lthis = this;
    this.update();
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
    this._sortStyle = 'title';

    var lthis = this;

    this._installChangeListener();
    noteBrowser.currentNoteID.getLive(function(val) {
        lthis._setListHilight(val);
    });
    this.update();
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
        dbInterface.off('change', lthis._changeListener);
    lthis._changeListener = null;
}
NoteList.prototype.update = function() {
    var lthis = this;

    $('#noteList li').remove();
    $.each(noteBrowser.getAllNotes(), function(id, note) {
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
        lthis._changeListener = dbInterface.on('change', function(doc) {
            if (doc.type && doc.type === 'note') {
                var note = new Note(doc);
                lthis._removeNote(note);
                lthis._insertNote(note);

                var hilightID = noteBrowser.currentNoteID.get();
                if (hilightID === note.getID())
                    lthis._setListHilight(hilightID);
            }
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
    if (this._sortStyle === 'title') {
        var l = this._getNoteLink(note, note.getTitle());
        this._insertElement(l, $('#noteList'), $('li', '#noteList'));
    } else if (this._sortStyle === 'tag') {
        /* XXX actually we should also include at least one note of each
         * unreachable cycle */
        var tagExists = function(tag) {
            return noteBrowser.getNoteByID(tag) !== undefined;
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


var Note = DBObject.extend({
    _init: function(id) {
        this._title = null;
        this._date = null;
        this._headRevObj = null;

        this._super(id);
        if (id === undefined) {
            this._dbObj.type = 'note';
            this._dbObj.title = '';
            this._dbObj.tags = [];
            this._dbObj.date = null;
            this._dbObj.headRev = null;
            this._dbObj.syncWith = {};
        }
    },
    copy: function() {
        return new Note(this._dbObj);
    },
    setDBObj: function(dbObj) {
        /* headRev can be null at the first save */
        if (dbObj.type === 'note' && typeof(dbObj.title) === 'string' &&
                                     /*typeof(dbObj.date) === 'string' &&*/
                                     /*$.isArray(dbObj.tags) &&*/
                                     typeof(dbObj.syncWith) === 'object') {
            if (this._dbObj.headRev !== dbObj.headRev)
                this._headRevObj = null;
            this._super(dbObj);
        } else {
            throw new Error("Invalid note object from database.");
        }
    },
    getTitle: function() {
        return (this._dbObj.title.length === 0) ? "Note" : this._dbObj.title;
    },
    getTags: function() {
        return this._dbObj.tags || [];
    },
    getDate: function() {
        return new Date(this._dbObj.date);
    },
    getRevision: function(revisionID) {
        var lthis = this;
        if (revisionID !== undefined && revisionID !== this._dbObj.headRev) {
            return (new NoteRevision(revisionID)).getConstructorPromise()
                .pipe(function(nr) {
                    if (nr.getNoteID() !== lthis.getID())
                        return $.Deferred().reject("Invalid revision object " + nr.getID()).promise();
                    return nr;
                });
        } else if (this._dbObj.headRev === null) {
            return $.when(null);
        } else {
            return this.getHeadRevision().pipe(function(hr) {
                return hr;
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
    getSyncTargets: function() {
        return this._dbObj.syncWith; /* XXX copy? */
    },
    getLocalSeq: function(syncTarget) {
        return this._dbObj.syncWith[syncTarget];
    },
    setText: function(text, tags, author, date, revType, parents) {
        var lthis = this;
        var nr = new NoteRevision();
        return nr.save(this.getID(), text, tags || [], author || null, date || (new Date()),
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
                dbObj.tags = revObj.getTags();
                dbObj.title = revObj.getTitle();
                dbObj.date = revObj.getDate();
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
                        dbObj.tags = revObj.getTags();
                        dbObj.title = newRevObj.getTitle();
                        dbObj.date = revObj.getDate();
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
    setLocalSeq: function(syncTarget, seq, options) {
        return this._save(function(dbObj) {
            if (syncTarget in dbObj.syncWith && dbObj.syncWith[syncTarget] === seq)
                return null;
            var s = dbObj.syncWith[syncTarget] || 0;
            dbObj.syncWith[syncTarget] = Math.max(s, seq);
            return dbObj;
        }, options);
    }
});
/* static */
Note.create = function(text) {
    /* first create the note to obtain an ID, then save the initial revision */
    return (new Note())._save().pipe(function(n) {
        return n.setText(text, [], null, null, 'create', []);
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
            dbObj.tags = revObj.getTags();
            dbObj.date = revObj.getDate();
            if (syncTarget === undefined) {
                dbObj.syncWith = {};
            } else {
                dbObj.syncWith[syncTarget] = 0;
            }
            return dbObj;
        }
    });
}
Note.mergeHeadsAndUpdate = function(noteID, headRevisions) {
    var lthis = this;
    if (headRevisions.length > 1) {
        /* TODO merge the revisions that are "close" */
        return headRevisions[0].createMergedRevision(headRevisions[1]).pipe(function(newRevObj) {
            var newHeads = headRevisions.splice(2);
            newHeads.push(newRevObj);
            return Note.mergeHeadsAndUpdate(noteID, newHeads);
        });
    }
    return (new Note(noteID)).getConstructorPromise().pipe(function(note) {
        return note.mergeWithRevision(headRevisions[0]);
    }, function() {
        console.log("Creating new Note: " + noteID);
        return Note.createWithExistingRevision(noteID, headRevisions[0]);
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
            this._dbObj.tags = null;
            this._dbObj.text = null;
        }
    },
    copy: function() {
        return new NoteRevision(this._dbObj);
    },
    setDBObj: function(dbObj) {
        /* XXX check for sorted parents and tags
         * XXX check for hash */
        if (dbObj.type === 'noteRevision' && typeof(dbObj.note) === 'string' &&
                    'date' in dbObj && 'author' in dbObj && typeof(dbObj.revType) === 'string' &&
                    $.isArray(dbObj.parents) && /*$.isArray(dbObj.tags) &&*/
                    typeof(dbObj.text) == 'string') {
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
    getDate: function() {
        return this._dbObj.date;
    },
    getParents: function() {
        return this._dbObj.parents; /* TODO copy? perhaps too expensive */
    },
    getTags: function() {
        return this._dbObj.tags || []; /* TODO copy? perhaps too expensive */
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
    createMergedRevision: function(otherRev) {
        var lthis = this;
        return this._findCommonAncestor(otherRev).pipe(function(parentId) {
            /* XXX if no common ancestor is found, use the empty revision */
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
                var date = lthis.getDate() > otherRev.getDate() ? lthis.getDate() : otherRev.getDate();
                var tags = MergeSortedLists(parentRev.getTags(), lthis.getTags(), otherRev.getTags());
                return (new NoteRevision()).save(lthis.getNoteID(), textMerged, tags, null, date,
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
        return NoteRevision.findCommonAncestor(this.getNoteID(), this.getID(), otherRev.getID());
    },
    save: function(noteID, text, tags, author, date, revType, parents) {
        return this._save(function(dbObj) {
            if ('_id' in dbObj || '_rev' in dbObj)
                throw new Error("Only new revisions can be saved.");
            dbObj.type = "noteRevision",
            dbObj.note = noteID, /* XXX this is actually redundant */
            dbObj.date = date,
            dbObj.author = author,
            dbObj.revType = revType,
            dbObj.parents = parents.sort(),
            dbObj.tags = tags.sort();
            dbObj.text = text
            /* TODO enforce normal form (encoding, etc) */
            dbObj._id = noteID + '/' + MD5.hex_md5(JSON.stringify(dbObj));
            return dbObj;
        });
    }
});

/* static */
NoteRevision.determineHeadRevisions = function(revisions) {
    var nonHeadRevisions = {};
    revisions.forEach(function(o) {
        o.getParents().forEach(function(pID) {
            nonHeadRevisions[pID] = 1;
        });
    });
    var headRevisions = {};
    revisions.forEach(function(o) {
        if (o.getID() in nonHeadRevisions)
            return;
        var noteID = o.getNoteID();
        if (!(noteID in headRevisions))
            headRevisions[noteID] = [];
        headRevisions[noteID].push(o);
    });
    return headRevisions;
}
NoteRevision.findCommonAncestor = function(note, revA, revB) {
    return dbInterface.getRevisionMetadata(note).pipe(function(revisions) {
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
                    return $.when(id);
            }
            for (var i = 0; i < newIDsB.length; i ++) {
                var id = newIDsB[i];
                ancestorsB[id] = true;
                if (id in ancestorsA)
                    return $.when(id);
            }

            newIDsA = getAllParents(newIDsA);
            newIDsB = getAllParents(newIDsB);
        }

        /* XXX use some empty parent in this case */
        return $.Deferred().reject("No common parent found.").promise();
    });
}

function SyncInterfaceCouchDB(url) {
    this._url = url;

    this._ajaxOpts = {type: 'GET',
                    contentType: 'application/json',
                    accept: 'application/json',
                    dataType: 'json',
                    cache: !$.browser.msie};
}
SyncInterfaceCouchDB.prototype.changedRevisions = function(noteID, since) {
    /* XXX we ignore noteID */
    return $.ajax($.extend(this._ajaxOpts, {
                        url: this._url + '/_changes',
                        data: {since: since}}))
        .pipe(function(res) {
            /* XXX this should only fetch revisions and optionally check fo
             * noteID */
            var docIDs = [];
            res.results.forEach(function(change) {
                var id = change.id;
                if (!change.deleted) /* ignore deletes */
                    docIDs[id] = 1;
            });
            return {lastSeq: res.last_seq, revisions: docIDs};
        }, function(req, error) {
            return "Error retrieving remote changed revision documents: " + error;
        });
}
SyncInterfaceCouchDB.prototype.getDocs = function(ids) {
    return $.ajax($.extend(this._ajaxOpts, {
                        type: 'POST',
                        url: this._url + '/_all_docs?include_docs=true',
                        processData: false,
                        data: JSON.stringify({keys: ids})}))
        .pipe(function(res) {
            return res.rows.map(function(row) {
                return row.doc;
            });
        }, function(req, error) {
            return "Error retrieving remote documents: " + error;
        });
}
SyncInterfaceCouchDB.prototype.saveRevisions = function(docs) {
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

/* interface to local filesystem without "list directory" capabilities,
 * will cause corruptions on simultaneous writes
 * XXX superseeded by LocalFileSystemDB, but this code can still be useful
 * for remote targets without "list directory" capabilities */
function SyncInterfaceLocalFile(url) {
    this._url = url;
    this._lastChangeSeq = 0;
}
SyncInterfaceLocalFile.prototype.changedRevisions = function(noteID, since) {
    var lthis = this;

    var docIDs = {};

    var d = $.Deferred();
    function readChangeFile(s) {
        LocalFileInterface.read(lthis._url + '/changes-' + s)
            .done(function(data) {
                try {
                    JSON.parse(data).foreach(function(id) {
                        if (typeof(id) === 'string')
                            docIDs[id] = 1;
                    });
                } catch (e) {
                    /* XXX report error? */
                }
                readChangeFile(s + 1);
            })
            .fail(function(err) {
                lthis._lastChangeSeq = s - 1;
                d.resolve({lastSeq: s - 1, docIDs: docIDs});
            });
    }
    readChangeFile((since || 0) + 1);
    return d.promise();
}
SyncInterfaceLocalFile.prototype.getDocs = function(ids) {
    var lthis = this;
    var docs = {};
    var d = $.Deferred();
    function readDoc(i) {
        if (i >= ids.length) {
            d.resolve(docs);
            return;
        }
        LocalFileInterface.read(lthis._url + '/' + ids[i])
            .done(function(data) {
                try {
                    /* XXX what if the stored id does not match the file name? */
                    var doc = JSON.parse(data);
                    docs[doc._id] = doc;
                } catch (e) {
                    /* XXX report error? */
                }
                readDoc(i + 1);
            })
            .fail(function(err) {
                readDoc(i + 1);
            });
    }
    readDoc(0);
    return d.promise();
}
SyncInterfaceLocalFile.prototype.saveRevisions = function(docs) {
    var lthis = this;
    var changes = [];
    var d = $.Deferred();
    function writeDoc(i) {
        if (i >= docs.length) {
            lthis._saveChanges(changes)
                .done(function() { d.resolve(); })
                .fail(function(err) { d.reject("Error saving changes log: " + err); });
            return;
        }
        /* XXX what if the id is "changes-2"? */
        var data = JSON.stringify(docs[i]);
        LocalFileInterface.write(lthis._url + '/' + docs[i]._id, data)
            .done(function() { writeDoc(i + 1); })
            .fail(function(err) { /* XXX report the error? */ writeDoc(i + 1); });
    }
    writeDoc(0);
    return d.promise();
}
SyncInterfaceLocalFile.prototype._findNextChangeSeq = function() {
    var lthis = this;

    var d = $.Deferred();
    function readChangeFile(s) {
        LocalFileInterface.read(lthis._url + '/changes-' + s)
            .done(function() { readChangeFile(s + 1); })
            .fail(function(err) { d.resolve(s); });
    }
    readChangeFile(this._lastChangeSeq + 1);
    return d.promise();
}
SyncInterfaceLocalFile.prototype._saveChanges = function(changes) {
    var lthis = this;
    return this._findNextChangeSeq().pipe(function(changeSeq) {
        return LocalFileInterface.write(lthis._url + '/changes-' + changeSeq,
                                JSON.stringify(changes));
    });
}

var getSyncInterface = function(url) {
    if (url.substr(0, 7) === 'file://') {
        return new LocalFileSystemDB(url, true);
    }  else {
        return new SyncInterfaceCouchDB(url);
    }
}


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
    copy: function() {
        return new SyncTarget(this._dbObj);
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
        var messageBox = noteBrowser.showInfo("Synchronizing with " + this.getName());

        var remoteDB = getSyncInterface(this.getURL());

        if (!$.support.cors) {
            try {
                if (netscape.security.PrivilegeManager.enablePrivilege) {
                    netscape.security.PrivilegeManager.enablePrivilege("UniversalBrowserRead");
                }
            } catch(e) {
                noteBrowser.showError("Error enabling UniversalBrowserRead: " + e.message);
            }
        }

        /* TODO reformat the error */

        noteBrowser.showInfo("Requesting changes since " + this.getRemoteSeq(), messageBox);
        return remoteDB.changedRevisions(null, this.getRemoteSeq()).pipe(function(remoteChanges) {
            /* TODO make this robust, catch exceptions and report them */
            /* XXX actually we should ask for the ids that are not missing... */
            return dbInterface.determineAvailableNoteRevisions(remoteChanges.revisions).pipe(function(availableObjs) {
                var objectsToFetch = remoteChanges.revisions.filter(function(id) { return !(id in availableObjs); });
                return lthis._fetchRevisions(remoteDB, objectsToFetch, remoteChanges.lastSeq, messageBox);
            });
        });
    },
    _fetchRevisions: function(remoteDB, ids, lastSeq, messageBox) {
        var lthis = this;
        /* TODO fetch them in batches */
        return remoteDB.getDocs(ids).pipe(function(objs) {
            var remoteObjects = new ObjectBag();
            var occuringParents = new ObjectBag();
            objs.forEach(function(o) {
                try {
                    o = new NoteRevision(o);
                } catch(e) {
                    return;
                }
                remoteObjects.insert(o);
                o.getParents().forEach(function(p) { occuringParents.insert(1, p); });
            });
            return dbInterface.determineAvailableNoteRevisions(occuringParents.idList()).pipe(function(availableParents) {
                    var checkedObjects = new ObjectBag();
                    /* XXX replace checking by less redundant data file,
                     * do not even check if parents exist.
                     * note that in this case, we could request a merge without
                     * a common ancestor! */
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
                            noteBrowser.showInfo("Parent missing: " + id, messageBox);
                        }
                    });

                    noteBrowser.showInfo("Valid objects: " + checkedObjects.idList().length, messageBox);
                    var docList = checkedObjects.map(function(o) { return o.getDBObject(); });
                    return dbInterface.saveRevisions(docList).pipe(function(res) {
                            /* TODO handle conflicts and save errors,
                             * update the objects? */

                            /* TODO really do this in parallel? */
                            var processes = $.map(NoteRevision.determineHeadRevisions(checkedObjects.objectList()),
                                                    function(revisions, noteID) {
                                /* TODO we do not want arbitrary people to cause
                                 * our notes to be merged we do not have marked
                                 * to be synchronized */
                                /* TODO merge these in one change file */
                                return Note.mergeHeadsAndUpdate(noteID, revisions);
                            });
                            processes.push(lthis._setRemoteSeq(lastSeq));
                            return DeferredSynchronizer(processes).pipe(function() {
                                /* XXX errors? */
                                return lthis._pushRevisions(checkedObjects, messageBox);
                            });
                        });
                });
        });
    },
    _pushRevisions: function(revsToIgnore, messageBox) {
        var lthis = this;
        noteBrowser.showInfo("Pushing objects to remote server.", messageBox);
        
        var notes = noteBrowser.getNotesBySyncTarget(this.getID());
        var noteSeqs = {};
        $.each(notes, function(id, note) {
            noteSeqs[id] = note.getLocalSeq(lthis.getID());
        });
        return dbInterface.changedRevisions(noteSeqs).pipe(function(res) {
            var revisionIDsToPush = [];
            res.revisions.forEach(function(rev) {
                if (!revsToIgnore.hasID(rev))
                    revisionIDsToPush.push(rev);
            });
            var lastSeq = res.lastSeq;
            var remoteDB = getSyncInterface(lthis.getURL());
            noteBrowser.showInfo("Objs to push: " + revisionIDsToPush.length, messageBox);
            /* TODO we could have errors in some processes */
            return dbInterface.getDocs(revisionIDsToPush).pipe(function(objs) {
                return remoteDB.saveRevisions(objs).pipe(function() {
                    return DeferredSynchronizer($.map(notes, function(note) {
                        return note.setLocalSeq(lthis.getID(), lastSeq, {'suppressChangeLog': true});
                    })).pipe(function() {
                        return dbInterface.logSuppressedChanges();
                    });
                });
            });
        });
    },
    _setRemoteSeq: function(remoteSeq) {
        return this._save(function(dbObj) {
            if (dbObj.remoteSeq === remoteSeq)
                return null;
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
