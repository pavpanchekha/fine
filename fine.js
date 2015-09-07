// There are four types of values in Fine:
// Pairs, left values, and right values, and points
// We represent these symmetrically, as
// {x: ?, y: ?}, {x: ?}, {y: ?}, and {}
// We likewise use a four-way branch often:

function test(o, pair, lft, rgt, point) {
    var x = typeof o.x !== "undefined";
    var y = typeof o.y !== "undefined";
    return x && y ? pair(o.x, o.y) : x ? lft(o.x) : y ? rgt(o.y) : point(o);
}

function pair(x, y) {return {x:x, y:y}}
function lft(x) {return {x:x}}
function rgt(y) {return {y:y}}
function pt() {return {}}
function ispt(x) {return typeof x.x === "undefined" && typeof x.y === "undefined"}

function error(str) {
    return function(x) {console.trace(); throw str;}
}

function branch(val) {
    var branches = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < branches.length - 1; i++) {
        var stop = false;
        var out = test(
            val,
            error("Didn't expect a pair!"),
            function(l) {stop = true; return branches[i](l)},
            function(r) {val = r},
            function(o) {stop = true; return o});
        if (stop) return out;
    }
    return branches[i](val);
}

function curry(f) {
    return function(x) {
        return test(x, function(x, y) {return f(x, y);},
                    error("Didn't expect a left!"),
                    error("Didn't expect a right!"),
                    error("Didn't expect a point!"));
    }
}

function id(x) {return x}

// The syntax is likewise simplistic:
// X ; id
// [X,Y] ; then
// X ; test
// X ; void
// [X,Y] ; pair
// X ; fst
// X ; snd
// [X,Y] ; cond
// X ; lft
// X ; rgt
// int ; builtin

instr_names =
    [ "id", "then", "test", "void",
      "pair", "fst", "snd", "cond", "lft", "rgt", "builtin" ];

function instr(n) {
    var x;
    var name = instr_names[n];
    if (arguments.length === 1) {
        x = pt();
    } else if (arguments.length === 2) {
        x = arguments[1];
    } else if (arguments.length === 3) {
        x = pair(arguments[1], arguments[2]);
    } else {
        throw "Invalid number of arguments to instr()";
    }
    x = lft(x);
    while (n-- != 0) x = rgt(x);
    x.name = name;
    return x;
}

ID = instr(0);
function THEN(x, y) {return instr(1, x, y)};
TEST = instr(2);
VOID = instr(3);
function PAIR(x, y) {return instr(4, x, y)};
FST = instr(5);
SND = instr(6);
function COND(x, y) {return instr(7, x, y)};
LFT = instr(8);
RGT = instr(9);
function BUILTIN(n) {return instr(10, n)};

function eval(v, fn) {
    if (typeof fn === "number") return fn;
    if (typeof fn === "string") return fn;

    return branch(
        fn,
        function _id() {return v},
        curry(function _then(x, y) {return eval(eval(v, x), y)}),
        function _test() {
            return test(
                v,
                function(x, y) {
                    return test(
                        x,
                        error("Didn't expect a pair!"),
                        function(l) { return lft(pair(l, y))},
                        function(r) { return rgt(pair(r, y))},
                        error("Didn't expect a point!"));
                },
                error("Didn't expect a left!"),
                error("Didn't expect a right!"),
                error("Didn't expect a point!")
            );
        },
        function _void() {return pt()}, //void
        curry(function _pair(x, y) {return pair(eval(v, x), eval(v, y))}),
        function _fst() {return curry(function(x, y){return x})(v)},
        function _snd() {return curry(function(x, y){return y})(v)},
        curry(function _cond(x, y) {
            return test(
                v,
                error("Didn't expect a pair!"),
                function(l) {return eval(l, x)},
                function(r) {return eval(r, y)},
                error("Didn't expect a point!"));
        }),
        function _lft() {return lft(v)},
        function _rgt() {return rgt(v)},
        function _builtin(x) {
            return BUILTINS[x.x](v)
        }
    );
}

// Tokens are easy:
// [ ] { } ( ) , \w+

function tokenize(str) {
    var i = 0;
    var tokens = [];
    while (i < str.length) {
        var one_char_tokens = "[](){},=";
        if (one_char_tokens.indexOf(str[i]) !== -1) {
            tokens.push(str[i++]);
        } else if (str[i] == '"') {
            for (var j = i+1; str[j] !== '"'; j++) {
                if (str[i] == "\\") i++;
            }
            tokens.push(str.substring(i, j+1));
            i = j+1;
        } else if (str[i].search(/^[\w-+:_]/) !== -1) {
            var re = /([\w-+:_]+)\s*/gim;
            re.lastIndex = i;
            var match = re.exec(str);
            i = re.lastIndex;
            tokens.push(match[1]);
        } else if (str[i].search(/^\s/m) !== -1) {
            var re = /\s*/gim;
            re.lastIndex = i;
            var match = re.exec(str);
            i = re.lastIndex;
        } else {
            throw ("Unexpected '" + str[i] + "' at location " + i);
        }
    }
    return tokens;
}

// Parse structure is easy:
// /\w+/
// '[' (? ',')* ? ']'
// '{' (? ',')* ? '}'
// '(' (? ',')* ? ')'

function reduce(fn, lst) {
    var x = lst[lst.length - 1];
    for (var i = lst.length - 2; i >= 0; i--) {
        x = fn(lst[i], x);
    }
    return x;
}

function parse(tok, i) {
    if (!i) i = 0;
    var steps = [];
    var lhs = undefined;
    while (i < tok.length) {
        var groupings = { "[": PAIR, "{": COND };
        var names = { "test": TEST, "void": VOID,
                      "fst": FST, "snd": SND, "lft": LFT, "rgt": RGT };
        if (groupings[tok[i]]) {
            var pieces = [];
            var starter = tok[i];
            var head = groupings[tok[i]];
            while (!pieces.length || tok[i] == ",") {
                var piece = parse(tok, i + 1);
                i = piece.i;
                pieces.push(piece.y);
            }

            steps.push(reduce(head, pieces));

            var closer = ({"[":"]", "{":"}", "(":")"})[starter];
            if (tok[i] === closer) i++;
            else throw ("Unexpected '" + tok[i] + "' at token " + i);
        } else if (names[tok[i]]) {
            steps.push(names[tok[i]]);
            i++;
        } else if (tok[i] === "(") {
            var pieces = [];
            while (!pieces.length || tok[i] == ",") {
                var piece = parse(tok, i + 1);
                i = piece.i;
                pieces.push(piece.y);
            }

            if (tok[i] === ")") i++;
            else throw ("Unexpected '" + tok[i] + "' at token " + i);
            //pieces[pieces.length - 1] = eval(pt(), pieces[pieces.length - 1])
            steps.push(reduce(eval, pieces));
        } else if (tok[i] === "=") {
            if (steps.length == 1 && !steps[0].x && !steps[0].y && steps[0].name) {
                lhs = steps[0];
            }
            steps = []
            i++;
        } else if ("])},".indexOf(tok[i]) !== -1) {
            break;
        } else if (tok[i].toLowerCase() != tok[i]) {
            var v = pt();
            v.name = tok[i];
            steps.push(v);
            i++;
        } else if (ENVIRONMENT[tok[i]]) {
            steps.push(ENVIRONMENT[tok[i]]);
            i++;
        } else if (tok[i][0] == '"') {
            steps.push(tok[i].substring(1, tok[i].length - 1));
            i++;
        } else if (tok[i].search(/^[0-9:]+$/) !== -1) {
            if (tok[i].indexOf(":") !== -1) {
                steps.push(parseFloat(tok[i].replace(":", ".")));
            } else {
                steps.push(parseInt(tok[i], 10));
            }
            i++
        } else {
            throw ("Unknown variable " + tok[i] + " at token " + i);
        }
    }
    var fn = steps.length ? reduce(THEN, steps) : ID;
    return {i: i, x:lhs, y: fn};
}

function run(code) {
    var toks = tokenize(code);
    var parse_result = parse(toks, 0);
    var fn;
    if (parse_result.i !== toks.length) {
        throw ("Unexpected '" + toks[parse_result.i] + "' at token " + i);
    }
    if (parse_result.x) {
        ENVIRONMENT[parse_result.x.name.toLowerCase()] = parse_result.y;
        return parse_result.y;
    } else {
        var out = eval(pt(), parse_result.y);
        return out;
    }
}

function print(val, is_code) {
    if (typeof val === "number") {
        return "" + val;
    } else if (typeof val === "string") {
        return '"' + val.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    } else if (val.name && typeof val.x === "undefined" && typeof val.y === "undefined") {
        return val.name;
    } else if (val.name && !is_code) {
        return '"' + print(val, true) + '"'
    } else if (val.name == "id") {
        return "";
    } else if (val.name == "then") {
        val = val.y.x;
        return print(val.x, true) + " " + print(val.y, true);
    } else if (val.name == "pair") {
        val = val.y.y.y.y.x;
        return "[" + print(val.x, true) + "," + print(val.y, true) + "]";
    } else if (val.name == "cond") {
        val = val.y.y.y.y.y.y.y.x;
        return "{" + print(val.x, true) + "," + print(val.y, true) + "}";
    } else if (val.name == "builtin") {
        return BUILTIN_NAMES[val.y.y.y.y.y.y.y.y.y.y.x];
    } else if (instr_names.indexOf(val.name) !== -1) {
        return val.name;
    } else {
        return test(
            val,
            function(x, y) { return "[" + print(x) + "," + print(y) + "]"},
            function(l) { return print(l) + " lft"},
            function(r) { return print(r) + " rgt"},
            function() { return "·"});
    }
}

fine_print = print;

function pretty(fn) {
    if (typeof fn.x === "undefined" && typeof fn.y === "undefined") {
        return fn;
    }

    function just(f) {return function(){return f;}}
    function rec(f) {
        return curry(function(x, y){return f(pretty(x), pretty(y));})
    }

    return branch(
        fn,
        just(ID),
        rec(THEN),
        just(TEST),
        just(VOID),
        rec(PAIR),
        just(FST),
        just(SND),
        rec(COND),
        just(LFT),
        just(RGT),
        function _builtin(x) {return BUILTIN(x.x)}
    );
}

function _quote(v) {
    if (typeof v !== "object" || typeof v.x === "undefined" && typeof v.y === "undefined" && v.name) {
        return v;
    }

    var out = test(v,
                function(x, y){return PAIR(_quote(x), _quote(y))},
                function(x){return THEN(_quote(x), LFT)},
                function(x){return THEN(_quote(x), RGT)},
                function(){return ID});

    return out
}

function quote(v) {
    return THEN(_quote(v), ENVIRONMENT[":code"]);
}

function html_run(src) {
    var $res = document.createElement("span");
    try {
        var toks = tokenize(src);
        var parse_result = parse(toks, 0);
        var fn;
        if (parse_result.i !== toks.length) {
            throw ("Unexpected '" + toks[parse_result.i] + "' at token " + i);
        }
        if (parse_result.x) {
            ENVIRONMENT[parse_result.x.name.toLowerCase()] = parse_result.y;
            $res.classList.add("defined");
        } else {
            var out = eval(pt(), parse_result.y);
            $res.classList.add("results");
            $res.textContent = print(out);
        }
    } catch (err) {
        $res.classList.add("error");
        $res.textContent = err;
    }
    return $res;
}

BUILTINS = [
    curry(function(x, y) {return x + y}),
    curry(function(x, y) {return x - y}),
    curry(function(x, y) {return x == y ? lft(x) : rgt(y)}),
    function(x) {return ENVIRONMENT[x] || pt()},
    pretty,
    quote,
]

BUILTIN_NAMES = ["+", "-", "equal", ":lookup", ":code", "quote"]

ENVIRONMENT = {
};

for (var i = 0; i < BUILTINS.length; i++) {
    ENVIRONMENT[BUILTIN_NAMES[i]] = BUILTIN(i);
}

function offsetLeft(elt) {
    if (!elt.offsetParent) return elt.offsetLeft;
    else return elt.offsetLeft + offsetLeft(elt.offsetParent);
}

function offsetTop(elt) {
    if (!elt.offsetParent) return elt.offsetTop;
    else return elt.offsetTop + offsetTop(elt.offsetParent);
}

function clear_hover(evt) {
    var $elt = evt.currentTarget;
    $elt.classList.remove("ins-top");
    $elt.classList.remove("ins-bot");
}

function code_hover(evt) {
    var $elt = evt.currentTarget;
    var relY = window.scrollY + evt.clientY - offsetTop($elt);
    var gap = $elt.classList.contains("ins-top") || $elt.classList.contains("ins-top") ? 5 : 0;
    if (relY < 5 + gap && $elt.previousElementSibling.tagName.toLowerCase() === "pre") {
        $elt.classList.add("ins-top");
    } else if (relY > $elt.clientHeight - 5 + gap && $elt.nextElementSibling.tagName.toLowerCase() === "pre") {
        $elt.classList.add("ins-bot");
    } else {
        clear_hover(evt);
    }
}

function insert_p(evt) {
    var $elt = evt.currentTarget;
    var relY = window.scrollY + evt.clientY - offsetTop($elt);
    if (relY < 10 && $elt.previousElementSibling.tagName.toLowerCase() === "pre") {
    } else if (relY > $elt.clientHeight && $elt.nextElementSibling.tagName.toLowerCase() === "pre") {
        ofNum++;
        $elt = $elt.nextSibling;
    } else return;
    clear_hover(evt);
    evt.stopPropagation();
    var ofNum = $elt.id;
    HISTORY.add("createComment", {of: ofNum}).querySelector("p").focus();
}

function edit_p(evt) {
    var $p = evt.currentTarget;
    var pnum = $p.parentNode.id;
    var content = $p.innerHTML;
    var pcontent = HISTORY.log[pnum].content;

    if (content !== pcontent) {
        HISTORY.add("editComment", {content: content, prev: pnum});
    }
}

function run_code(evt) {
    var $body = document.getElementsByTagName("body")[0];
    var $src = document.getElementById("src");
    HISTORY.add("run", {src: $src.value});
    evt.preventDefault();
}

function delete_container(evt) {
    var $elt = evt.currentTarget.parentNode;
    HISTORY.add("delete", {prev: $elt.id});
    evt.stopPropagation();
}

HISTORY = {log: [], time: 0};

HISTORY.handlers = {
    editComment: function(o) {
        var $p = document.getElementById(o.prev).querySelector("p");
        if (!$p) console.trace();
        $p.innerHTML = o.content;
        return $p;
    },
    createComment: function(o) {
        var $elt = document.getElementById(o.of);
        var $div = document.createElement("div");
        $elt.parentNode.insertBefore($div, $elt);
        $div.classList.add("comment");
        var $p = document.createElement("p");
        $p.setAttribute("contentEditable", "true");
        $p.addEventListener("blur", edit_p);
        if (o.content) $p.innerHTML = o.content;
        $div.appendChild($p);
        var $del = document.createElement("a");
        $del.addEventListener("click", delete_container);
        $del.textContent = "✘";
        $del.classList.add("delete-button");
        $div.appendChild($del);
        return $div;
    },
    run: function(o) {
        var $iform = document.getElementById("iform");
        var $body = document.getElementsByTagName("body")[0];
        var $out = document.createElement("pre");
        $out.textContent = o.src;
        var $res = html_run(o.src);
        $out.appendChild($res);
        $body.insertBefore($out, $iform);
        $out.addEventListener("mousemove", code_hover);
        $out.addEventListener("click", insert_p);
        $out.addEventListener("mouseover", code_hover);
        $out.addEventListener("mouseout", clear_hover);
        var $del = document.createElement("a");
        $del.addEventListener("click", delete_container);
        $del.textContent = "✘";
        $del.classList.add("delete-button");
        $out.appendChild($del);
        return $out;
    },
    delete: function(o) {
        var $elt = document.getElementById(o.prev);
        $elt.remove();
        return $elt;
    },
}

HISTORY.run = function() {
    var o, $elt;
    while (HISTORY.time < HISTORY.log.length) {
        o = HISTORY.log[HISTORY.time];
        $elt = HISTORY.handlers[o.type](o);
        $elt.id = HISTORY.time;
        HISTORY.time++;
    }
    return $elt;
}

HISTORY.add = function(type, o) {
    o.type = type;
    HISTORY.log.push(o);
    HISTORY.save();
    return HISTORY.run();
}

HISTORY.save = function() {
    window.localStorage.setItem("history", JSON.stringify(HISTORY.log));
}

HISTORY.clear = function() {
    HISTORY.log = [];
    HISTORY.time = 0;
    HISTORY.save();
}

function setup() {
    var $iform = document.getElementById("iform");
    $iform.addEventListener("submit", run_code);

    var pres = document.querySelectorAll("pre");
    for (var i = 0; i < pres.length; i++) {
        if (pres[i].id !== "prelude") {
            var $res = html_run(pres[i].textContent);
            pres[i].appendChild($res);
        } else {
            var srcs = pres[i].textContent.split("\n");
            for (var j = 0; j < srcs.length; j++) {
                run(srcs[j]);
            }
        }
    }

    var h = JSON.parse(window.localStorage.getItem("history"));
    if (h) HISTORY.log = h;
    HISTORY.run();
    var $src = document.getElementById("src");
    $src.focus();
}

window.addEventListener("load", setup);
