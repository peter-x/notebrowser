define(['jquery', 'showdown',
        'ui/revisiongraph', 'ui/logger',
        'util/deferredsynchronizer',
        'db/local', 'db/objectcache'], function($, Showdown, RevisionGraph, logger, DeferredSynchronizer, db, objectCache) {
"use strict";

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
    this._viewAreaTags = null;
    this._viewAreaSubtags = null;
    this._viewAreaText = null;

    this._showdown = new Showdown.converter();

    this._syncTable = null;
    this._revisionGraph = null;
    this._revisionGraphVisible = false;

    this._findUIElements();

    this._noteText = '';
    this._noteTags = [];
    this._lastRenderDuration = 500;
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
    db.off('change', this._changeListener);
}
NoteViewer.prototype._installChangeListener = function() {
    var lthis = this;
    if (this._changeListener === null) {
        this._changeListener = db.on('change', function(doc) {
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
    this._viewAreaTags = $('#viewAreaTags');
    this._viewAreaSubtags = $('#viewAreaSubtags');
    this._viewAreaText = $('#viewAreaText');

    $('#editTags').keyup(function() { lthis._tagsTextChanged(); });
    function checkForTextChange() {
        if (lthis._editMode && $('textarea', lthis._editArea).val() !== lthis._lastRawText)
            lthis._textChanged();
    }
    $('textarea', this._editArea).keyup(checkForTextChange);
    window.setInterval(checkForTextChange, 1000);
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
                      Math.min(4.0 * this._lastRenderDuration, 2000));
}
NoteViewer.prototype._tagsTextChanged = function() {
    if (!this._editMode)
        return;

    this._doRenderTags();
}
NoteViewer.prototype._getTagsFromInput = function() {
    var lthis = this;
    var tags = [];
    $('#editTags').val().split(',').forEach(function(tag) {
        tag = tag.trim();
        if (tag === '')
            return;
        if (objectCache.getNoteByID(tag) !== undefined) {
            tags.push(tag);
        } else {
            var note = objectCache.getFirstNoteByTitle(tag);
            tags.push(note !== undefined ? note.getID() : tag);
        }
    });
    return tags;
}
NoteViewer.prototype._doRenderTags = function() {
    /* XXX listen on changes to these notes? */
    var lthis = this;
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
        var note = objectCache.getNoteByID(tag);
        if (note === undefined) {
            tagArea.append($('<span></span>').text(tag));
        } else {
            tagArea.append($('<a></a>', {href: '#' + note.getID()}).text(note.getTitle()));
        }
    });
}
NoteViewer.prototype._doRenderSubtags = function() {
    var lthis = this;
    /* XXX listen on changes to these notes? */
    var tagAreas = $('div', '#viewAreaSubtags').empty();

    var StringCmp = function(a, b) {
        if (a < b) {
            return -1
        } else if (a > b) {
            return 1;
        } else {
            return 0;
        }
    }

    function renderRec(tag, targets, parents) {
        var notes = $.map(objectCache.getNotesByTag(tag), function(note) { return note; });
        if (notes.length === 0) return 0;

        parents[tag] = 1;
        var children = [];
        var childrenSizes = [];
        notes.sort(function(a, b) { return StringCmp(a.getTitle(), b.getTitle()); })
            .forEach(function(note) {
                var id = note.getID();
                var title = note.getTitle();
                var li = $('<li></li>')
                    .append($('<a></a>', {href: '#' + id}).text(title));
                var childSize = 1;
                if (id in parents) {
                    $('<ul><li>(loop)</li></ul>').appendTo(li);
                    childSize += 1;
                } else {
                    childSize += renderRec(id, li, parents);
                }
                children.push(li);
                childrenSizes.push(childSize);
            });
        delete parents[tag];

        var numItems = childrenSizes.length === 0 ? 0 : childrenSizes.reduce(function(a, b) { return a + b; });
        var itemsPositioned = 0;
        var child = 0;
        targets.each(function(i, target) {
            var ul = $('<ul></ul>').appendTo(target);
            while (itemsPositioned < (i + 1) / targets.length * numItems) {
                children[child].appendTo(ul);
                itemsPositioned += childrenSizes[child];
                child += 1;
            }
        });

        return numItems;
    }
    renderRec(this._note.getID(), tagAreas, {});
}
NoteViewer.prototype._doRender = function(math) {
    var lthis = this;

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

    if (math && window.MathJax) {
        this._getMathHeaderTexts().pipe(function(headerText) {
            if (headerText.length > 0)
                lthis._viewAreaText.prepend($('<div style="display: none;"/>').text(headerText));
            var text = lthis._viewAreaText[0];
            window.MathJax.Hub.Queue(["Typeset", MathJax.Hub, text]);
        });
    }

    /* this includes the time for math rendering if the header text is
     * available right away */
    this._lastRenderDuration = (new Date()) - start;
    if (this._editMode) {
        $('textarea', this._editArea).height(Math.max(800, $('#viewAreaText').height()));
    }
}
NoteViewer.prototype._getMathHeaderTexts = function() {
    var processes = [];
    var headerText = '';

    this._noteTags.forEach(function(tagID) {
        var prefix = "math header";
        var tag = objectCache.getNoteByID(tagID);
        if (tag === undefined)
            return;
        if (tag.getTitle().substr(0, prefix.length) !== prefix)
            return;
        processes.push(tag.getHeadRevision().pipe(function(hr) {
            headerText += hr.getText().replace(/^\s*#(.+)/, '') + '\n\n';
        }));
    });
    return DeferredSynchronizer(processes).pipe(function() {
        return headerText;
    });
}
NoteViewer.prototype.closeNote = function() {
    this._note = null;
    this._revision = null;
    if (this._revisionGraph !== null) {
        this._revisionGraph.destroy();
        this._revisionGraph = null;
    }
    this._viewAreaTags.empty();
    $('div', this._viewAreaSubtags).empty();
    this._viewAreaTags.empty();
}
NoteViewer.prototype.showNote = function(note, revision) {
    this._showNote(note, revision, false);
}
NoteViewer.prototype.showEditNote = function(note, revision) {
    this._showNote(note, revision, true);
}
NoteViewer.prototype._showNote = function(note, revision, edit) {
    var noteChange = !this._note || this._note.getID() !== note.getID();
    if (noteChange)
        this.closeNote();
    this._note = note.copy();
    this._revision = revision;

    if (this._revisionGraphVisible && this._revisionGraph === null) {
        this._createRevisionGraph();
    } else if (this._revisionGraph !== null) {
        this._revisionGraph.setCurrentRevision(revision === undefined ? this._note.getHeadRevisionID() : revision,
                                               noteChange ? note : undefined);
    }
    this._updateSyncTable();
    if (edit) {
        this._toEditMode();
    } else {
        this._toViewMode();
    }
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

            lthis._editMode = true;
            lthis._buttonEdit.hide();
            lthis._buttonSave.show();
            lthis._buttonCancel.show();
            lthis._viewAreaText
                .removeClass('span9')
                .addClass('span4');
            lthis._editArea.show();
            $('textarea', lthis._editArea)
                .val(text)
                .focus();
            $('#editTags').val(tags.join(', '));

            lthis._doRender(true);
        })
        .fail(function(err) {
            logger.showError(err);
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

            lthis._viewAreaText
                .removeClass('span4')
                .addClass('span9');
            lthis._editArea.hide();

            lthis._doRender(true);
        })
        .fail(function(err) {
            logger.showError(err);
        });

}
NoteViewer.prototype._updateSyncTable = function() {
    var lthis = this;
    this._syncTableArea.empty();
    var table = $('<table class="table table-striped table-bordered"><thead>' +
                        '<tr><th>Sync Target</th><th>&nbsp;</th></tr>' +
                        '</thead></table>');
    var tbody = $('<tbody/>').appendTo(table);
    $.each(objectCache.getAllSyncTargets(), function(id, target) {
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
    this._syncTableArea.empty();
    table.appendTo(lthis._syncTableArea);
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
            logger.showError(err);
        });
}
NoteViewer.prototype._cancelChanges = function() {
    this._toViewMode();
}
NoteViewer.prototype._toggleRevisionGraph = function() {
    var lthis = this;
    this._revisionGraphVisible = !this._revisionGraphVisible;
    if (this._revisionGraph === null) {
        this._createRevisionGraph();
        this._revisionGraphArea.show('slow', function() {
            lthis._revisionGraph.redraw();
        });
    } else {
        this._revisionGraphArea.toggle('slow');
    }
}
NoteViewer.prototype._createRevisionGraph = function() {
    var rev = this._revision;
    if (rev === undefined)
        rev = this._note.getHeadRevisionID();
    this._revisionGraph = new RevisionGraph(this, this._note, rev, this._revisionGraphArea);
}
NoteViewer.prototype._toggleSyncTargets = function() {
    this._syncTableArea.toggle('slow');
}

return NoteViewer;
});
