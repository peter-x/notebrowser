function Diff(s1, s2) {
    this.s1 = s1;
    this.s2 = s2;
}
Diff.prototype._forwardSearch = function forwardSearch(p1, p2, q1, q2) {
    var s1 = this.s1;
    var s2 = this.s2;

    var costs = [new Array(), new Array()];
    for (var j = 0; j <= q2 - q1; j ++)
        costs[p1 % 2][q1 + j] = j; /* insert */
    
    for (var i = p1 + 1; i <= p2; i++) {
        costs[i % 2][q1] = costs[(i - 1) % 2][q1] + 1; /* delete */
        
        for (var j = q1 + 1; j <= q2; j++) {
            var diag = costs[(i - 1) % 2][j - 1];
            if (s1[i - 1] !== s2[j - 1]) diag += 2; /* delete + insert */
            
            costs[i % 2][j] = Math.min(diag,
                                   costs[(i - 1) % 2][j] + 1, /* delete */
                                   costs[i % 2][j - 1] + 1); /* insert */
        }
    }
    return costs[p2 % 2];
}

Diff.prototype._reverseSearch = function reverseSearch(p1, p2, q1, q2) {
    var s1 = this.s1;
    var s2 = this.s2;

    var costs = [new Array(), new Array()];
    costs[p2 % 2][q2] = 0;
    for (var j = q2 - 1; j >= q1; j--)
        costs[p2 % 2][j] = costs[p2 % 2][j + 1] + 1;
    
    for (var i = p2 - 1; i >= p1; i--) {
        costs[i % 2][q2] = costs[(i + 1) % 2][q2] + 1;
        
        for (var j = q2 - 1; j >= q1; j--) {
            var diag = costs[(i + 1) % 2][j + 1];
            if (s1[i] !== s2[j]) diag += 2; /* delete + insert */
            
            costs[i % 2][j] = Math.min(diag, 
                                   costs[(i + 1) % 2][j] + 1, 
                                   costs[i % 2][j + 1] + 1);
        }
    }
    return costs[p1 % 2];
}

Diff.prototype._calculateDiffOps = function _calculateDiffOps(p1, p2, q1, q2) {
    var s1 = this.s1;
    var s2 = this.s2;

    var ls1 = p2 - p1;
    var ls2 = q2 - q1;
    
    if (ls1 <= 0 && ls2 <= 0) {
        return [];
    } else if (ls1 <= 0) {
        return [[Diff.OPS.insert, s2.substring(q1, q2)]];
    } else if (ls2 <= 0) {
        return [[Diff.OPS.remove, ls1]];
    } else if (ls1 == 1) {
        var i = s2.indexOf(s1[p1], q1);
        if (i < 0 || i >= q2) {
            /* not found */
            return [[Diff.OPS.remove, 1], [Diff.OPS.insert, s2.substring(q1, q2)]];
        } else {
            return [[Diff.OPS.insert, s2.substring(q1, i)],
                    [Diff.OPS.leave, 1],
                    [Diff.OPS.insert, s2.substring(i + 1, q2)]];
        }
    } else {
        /* ls1 >= 2, divide and conquer, find optimal division */
        var mid = Math.floor((p1 + p2) / 2);
        var fwd = this._forwardSearch(p1, mid, q1, q2);
        var rev = this._reverseSearch(mid, p2, q1, q2, rev);
        var s2mid = q1, best = Number.MAX_VALUE;
        for (var i = q1; i <= q2; i++) {
            var sum = fwd[i] + rev[i];
            if (sum < best) {
                best = sum;
                s2mid = i;
            }
        }
        return [].concat(this._calculateDiffOps(p1, mid, q1, s2mid),
                         this._calculateDiffOps(mid, p2, s2mid, q2));
    }
}

Diff.prototype.calculateDiffOps = function calculateDiffOps() {
    return this._calculateDiffOps(0, this.s1.length, 0, this.s2.length);
}

/* static */

/* enum */
Diff.OPS = {insert: 1, /*replace: 2,*/ remove: 3, leave: 4};

/* ---------------------------------------------------------------------- */

/* this class consumes the ops array */
function OpStream(ops) {
    this._ops = ops;
    this.currentOp = null;
    this.nextOp();
}
OpStream.prototype.nextOp = function() {
    while (this._ops.length > 0) {
        var op = this._ops[0];
        if (op[0] === Diff.OPS.insert) {
            if (op[1].length == 0) {
                this._ops.shift();
                continue;
            } else {
                this.currentOp = [Diff.OPS.insert, op[1][0]];
                op[1] = op[1].substr(1);
                return;
            }
        } else if (op[0] === Diff.OPS.remove) {
            if (op[1] == 0) {
                this._ops.shift();
                continue;
            } else {
                op[1] --;
                this.currentOp = [Diff.OPS.remove];
                return;
            }
        } else {
            /* leave */
            if (op[1] == 0) {
                this._ops.shift();
                continue;
            } else {
                op[1] --;
                this.currentOp = [Diff.OPS.leave];
                return;
            }
        }
    }
    this.currentOp = [null];
}

/* ---------------------------------------------------------------------- */

/* TODO the order of textA and textB is important! */
function Merge(textParent, textA, textB) {
    this.textParent = textParent;
    this.diffA = new Diff(textParent, textA);
    this.diffB = new Diff(textParent, textB);
}
Merge.prototype.getMergedText = function getMergedText() {
    var streamA = new OpStream(this.diffA.calculateDiffOps());
    var streamB = new OpStream(this.diffB.calculateDiffOps());
    var mergedText = '';

    var pos = 0;
    while (streamA.currentOp[0] !== null || streamB.currentOp[0] !== null) {
        /* TODO what if both insert the same symbol? */
        while (streamA.currentOp[0] === Diff.OPS.insert) {
            mergedText += streamA.currentOp[1];
            streamA.nextOp();
        }
        while (streamB.currentOp[0] === Diff.OPS.insert) {
            mergedText += streamB.currentOp[1];
            streamB.nextOp();
        }
        /* both are leave or remove, remove has precedence */
        if (streamA.currentOp[0] === Diff.OPS.leave && streamB.currentOp[0] === Diff.OPS.leave)
            mergedText += this.textParent[pos];
        streamA.nextOp();
        streamB.nextOp();
        pos ++;
    }
    return mergedText;
}
