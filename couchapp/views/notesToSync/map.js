function(doc) {
  if (doc.type == 'note') {
    for (var targetID in doc.syncWith) {
        emit(targetID, doc._id);
    }
  }
}
