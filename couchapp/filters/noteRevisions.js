function (doc, req) {
    return doc.type === 'noteRevision' && doc.note === req.query.note;
}
