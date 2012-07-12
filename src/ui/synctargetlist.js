define(['jquery', 'db/objectcache'], function($, objectCache) {
"use strict";

function SyncTargetList() {
    this._changeListener = null;

    var lthis = this;
    objectCache.on('ready', function() { lthis.update(); });
    this._changeListener = objectCache.on('synctarget changed', function(syncTarget) {
        lthis._updateListEntry(syncTarget);
    });
}
SyncTargetList.prototype.destroy = function() {
    if (this._changeListener !== null)
        objectCache.off('synctarget changed', this._changeListener);
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
    $.each(objectCache.getAllSyncTargets(), function(id, target) {
        lthis._updateListEntry(target);
    });
}

return new SyncTargetList();
});
