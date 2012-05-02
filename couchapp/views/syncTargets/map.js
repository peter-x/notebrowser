function(doc) {
  if (doc.type == 'syncTarget')
    emit(doc.name, null);
}
