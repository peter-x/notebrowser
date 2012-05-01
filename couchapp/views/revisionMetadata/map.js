function(doc) {
  if (doc.type == 'noteRevision') {
    emit(doc.note, {'_id': doc._id, '_rev': doc._rev,
                    'date': doc.date, 'author': doc.author,
                    'revType': doc.revType, 'parents': doc.parents});
  }
}
