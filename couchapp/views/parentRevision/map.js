function(doc) {
  if (doc.type == 'noteRevision')
    for (i in doc.parents)
      emit(doc._id, doc.parents[i]);
}
