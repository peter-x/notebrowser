define(['jquery', 'db/local', 'db/objectcache', 'ui/logger'], function($, db, objectCache, logger) {
"use strict";

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
    this._scrollArea = null;
    this._canvas = null;

    this._revisions = {};
    this.redraw();

    this._installChangeListener();
    this._reload();
}
RevisionGraph.prototype.destroy = function() {
    /* TODO make sure this gets called */
    db.off('change', this._changeListener);
    this._container.empty();
    this._scrollArea = null;
}
RevisionGraph.prototype._installChangeListener = function() {
    var lthis = this;
    if (lthis._changeListener === null) {
        lthis._changeListener = db.on('change', function(doc) {
            if (doc.type && doc.type == 'noteRevision' && doc.note && doc.note === lthis._note.getID()) {
                lthis._revisions[doc._id] = doc;
                lthis._updateHierarchyAndRedraw(false);
            }
        });
    }
}
RevisionGraph.prototype._reload = function() {
    var lthis = this;
    db.getRevisionMetadata(this._note.getID())
        .fail(function(err) { logger.showError("Error loading revisions: " + err); })
        .done(function(revs, updateSeq) {
            lthis._revisions = revs;
            lthis._updateHierarchyAndRedraw(true);
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
RevisionGraph.prototype._updateHierarchyAndRedraw = function(reload) {
    var root = this._getRoots();
    var children = this._getChildrenMap();

    var numRevisions = 0;
    $.each(this._revisions, function() { numRevisions += 1; });
    this._revisionPositions = {};
    var queue = {};
    this._getRoots().forEach(function(root) { queue[root] = 1; });
    var x = 0;
    var cont = true;
    var maxColumn = 0;

    /* we can have loops */
    while (cont && x < numRevisions + 2) {
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

    var oldWidth = this._width;
    
    this._width = Math.max((x - 1) * this._horDistance + 2 * this._horBorder, 10);
    this._height = Math.max((maxColumn - 1) * this._horDistance + 2 * this._verBorder, 10);

    var widthChange = undefined;
    if (oldWidth !== null && this._scrollArea !== null)
        widthChange = this._width - oldWidth;

    this.redraw(widthChange, reload);
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
RevisionGraph.prototype._updateUIElements = function(widthChange, reload) {
    var oldScrollPos = this._scrollArea !== null ? this._scrollArea.scrollLeft() : -1;
    this._container.empty();
    this._scrollArea = $('<div style="position: relative; width: 100%; height: 160px; overflow: auto;"/>')
                .appendTo(this._container);
    this._canvas = $('<canvas style="width: 500px; height: 100px;"></canvas>')
        .appendTo(this._scrollArea);
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
                var n = objectCache.getNoteByID(noteID);
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
        trigger.appendTo(lthis._scrollArea);
    });
    showInfo(this._currentRevision);
    if (oldScrollPos === -1 || reload) {
        this._scrollArea.scrollLeft(this._width);
    } else {
        if (widthChange !== undefined && oldScrollPos + this._scrollArea.width() >= this._width - widthChange) {
            this._scrollArea.scrollLeft(oldScrollPos + widthChange);
        } else {
            this._scrollArea.scrollLeft(oldScrollPos);
        }
    }
}
RevisionGraph.prototype.redraw = function(widthChange, reload) {
    if (reload === undefined) reload = true;
    this._updateUIElements(widthChange, reload);

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
        this._reload();
    } else {
        this.redraw(undefined, false);
    }
}

return RevisionGraph;
});
