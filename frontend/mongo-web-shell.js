/* jshint camelcase: false, evil: true, unused: false */
/* global falafel */
var mongo = {};

// Protect older browsers from an absent console.
if (!console || !console.log) { var console = { log: function () {} }; }
if (!console.debug || !console.error || !console.info || !console.warn) {
  console.debug = console.error = console.info = console.warn = console.log;
}

/**
 * Injects a mongo web shell into the DOM wherever an element of class
 * 'mongo-web-shell' can be found. Additionally sets up the resources
 * required by the web shell, including the mws REST resource and the mws
 * CSS stylesheets.
 */
mongo.init = function () {
  var config = mongo.dom.retrieveConfig();
  mongo.dom.injectStylesheet(config.cssPath);
  $('.mongo-web-shell').each(function (index, shellElement) {
    var shell = new MWShell(shellElement);
    shell.injectHTML();

    // Attempt to create MWS resource on remote server.
    $.post(config.baseUrl, null, function (data, textStatus, jqXHR) {
      if (!data.res_id) {
        // TODO: Print error in shell. Improve error below.
        console.warn('No res_id received! Shell disabled.', data);
        return;
      }
      console.info('/mws/' + data.res_id, 'was created succssfully.');
      shell.attachInputHandler(data.res_id);
      shell.enableInput(true);
    },'json').fail(function (jqXHR, textStatus, errorThrown) {
      // TODO: Display error message in the mongo web shell.
      console.error('AJAX request failed:', textStatus, errorThrown);
    });
  });
};

mongo.const = (function () {
  var KEYCODES = {
    enter: 13,
    left: 37,
    up: 38,
    right: 39,
    down: 40
  };

  return {
    keycodes: KEYCODES
  };
}());

mongo.dom = (function () {
  // TODO: Document these data attributes.
  // TODO: Should each shell be able to have its own host?
  // Default config values.
  var CSS_PATH = 'mongo-web-shell.css';
  var MWS_HOST = 'http://localhost:5000';
  var BASE_URL = MWS_HOST + '/mws';

  function retrieveConfig() {
    var $curScript = $('script').last();
    var mwsHost = $curScript.data('mws-host') || MWS_HOST;
    return {
      cssPath: $curScript.data('css-path') || CSS_PATH,
      mwsHost: mwsHost,
      baseUrl: mwsHost + '/mws'
    };
  }

  function injectStylesheet(cssPath) {
    var linkElement = document.createElement('link');
    linkElement.href = cssPath;
    linkElement.rel = 'stylesheet';
    linkElement.type = 'text/css';
    $('head').prepend(linkElement); // Prepend so css can be overridden.
  }

  return {
    retrieveConfig: retrieveConfig,
    injectStylesheet: injectStylesheet
  };
}());

mongo.mutateSource = (function () {
  var KEYWORDS = {
    help: true,
    show: true,
    use: true
  };
  function isKeyword(id) { return KEYWORDS[id]; }

  var NODE_TYPE_HANDLERS = {
    'MemberExpression': mutateMemberExpression,
    'UnaryExpression': mutateUnaryExpression
  };

  function mutateMemberExpression(node) {
    // Search for an expression of the form "db.collection.method()",
    // attempting to match from the "db.collection" MemberExpression node as
    // this is the one that will be modified.
    var dbNode = node.object, collectionNode = node.property,
        methodNode = node.parent;
    // TODO: Resolve db reference from a CallExpression.
    // TODO: Resolve db.collection reference from a CallExpression.
    if (dbNode.type !== 'Identifier') { return; }
    // TODO: Resolve db reference in other identifiers.
    if (dbNode.name !== 'db') { return; }
    // As long as this AST is more complex than "db.collection", continue.
    if (methodNode.type === 'ExpressionStatement') { return; }

    // TODO: Make a call to a function that will return an object with methods
    // corresponding to mongo db.collection methods. Note we probably need a
    // shell reference. Like:
    // var args = [shellID, collectionNode.source()].join(', ');
    // node.update('generateCursor(' + args + ')');
    console.debug('mutateMemberExpression(): would have mutated source',
        node.source());
  }

  function mutateUnaryExpression(node) {
    switch (node.operator) {
    case 'help':
    case 'show':
    case 'use':
      console.warn('mutateUnaryExpression(): mutation of keyword "' +
          node.operator + '" not yet implemented. Removing node source to ' +
          'prevent parser errors.');
      node.update('');
      break;
    default:
      console.debug('mutateUnaryExpression(): keyword "' + node.operator +
          '" is not mongo specific. Ignoring.');
    }
  }

  /**
   * Replaces mongo shell specific input (such as the `show` keyword or * `db.`
   * methods) in the given javascript source with the equivalent mongo web
   * shell calls and returns this mutated source. This transformation allows
   * the code to be interpretted as standard javascript in the context of this
   * html document.
   */
  function swapMongoCalls(src) {
    var output = falafel(src, {isKeyword: isKeyword}, function (node) {
      if (NODE_TYPE_HANDLERS[node.type]) {
        NODE_TYPE_HANDLERS[node.type](node);
      }
    });
    return output.toString();
  }

  return {
    swapMongoCalls: swapMongoCalls,

    _isKeyword: isKeyword,
    _mutateMemberExpression: mutateMemberExpression,
    _mutateUnaryExpression: mutateUnaryExpression
  };
}());

mongo.Readline = function ($input) {
  this.$input = $input;
  this.history = []; // Newest entries at Array.length.
  this.historyIndex = history.length;

  var readline = this;
  this.$input.keydown(function (event) { readline.keydown(event); });
};

mongo.Readline.prototype.keydown = function (event) {
  var key = mongo.const.keycodes;
  var line;
  switch (event.keyCode) {
  case key.up:
    line = this.getOlderHistoryEntry();
    break;
  case key.down:
    line = this.getNewerHistoryEntry();
    break;
  case key.enter:
    this.submit(this.$input.val());
    break;
  default:
    return;
  }

  if (line !== undefined && line !== null) {
    this.$input.val(line);
  }
};

mongo.Readline.prototype.getNewerHistoryEntry = function () {
  var old = this.historyIndex;
  this.historyIndex = Math.min(this.historyIndex + 1, this.history.length);
  if (this.historyIndex === this.history.length && old !== this.historyIndex) {
    // TODO: Restore command first being written (you may be able to remove the
    // old check, depending on how it's done).
    return '';
  }
  return this.history[this.historyIndex];
};

mongo.Readline.prototype.getOlderHistoryEntry = function () {
  this.historyIndex = Math.max(this.historyIndex - 1, 0);
  return this.history[this.historyIndex];
};

mongo.Readline.prototype.submit = function (line) {
  // TODO: Remove old entries if we've hit the limit.
  this.history.push(line);
  this.historyIndex = this.history.length;
};

var MWShell = function (rootElement) {
  this.$rootElement = $(rootElement);
  this.$input = null;
  this.mwsResourceID = null;
  this.readline = null;
};

MWShell.prototype.injectHTML = function () {
  // TODO: Use client-side templating instead.
  // TODO: Why is there a border class? Can it be done with CSS border (or
  // be renamed to be more descriptive)?
  // TODO: .mshell not defined in CSS; change it.
  var html = '<div class="mws-border">' +
               '<div class="mshell">' +
                 '<ul class="mws-in-shell-response"></ul>' +
                 '<form>' +
                   '<input type="text" class="mws-input" disabled="true">' +
                 '</form>' +
               '</div>' +
             '</div>';
  this.$rootElement.html(html);
  this.$input = this.$rootElement.find('.mws-input');
};

MWShell.prototype.attachInputHandler = function (mwsResourceID) {
  var shell = this;
  this.mwsResourceID = mwsResourceID;
  this.$rootElement.find('form').submit(function (e) {
    e.preventDefault();
    shell.handleInput();
  });
  this.readline = new mongo.Readline(this.$input);
};

/**
 * Retrieves the input from the mongo web shell, evaluates it, handles the
 * responses (indirectly via callbacks), and clears the input field.
 */
MWShell.prototype.handleInput = function () {
  var mutatedSrc, userInput = this.$input.val();
  try {
    mutatedSrc = mongo.mutateSource.swapMongoCalls(userInput);
    try {
      console.debug('MWShell.handleInput(): mutated source:', mutatedSrc);
      eval(mutatedSrc);
    } catch (err) {
      // TODO: This is an error on the mws front since esprima should catch
      // standard js syntax errors in the user input and thus eval will only
      // choke on mongo-specific sugar. Figure out how we should handle this.
      console.error('MWShell.handleInput(): eval error:', err);
    }
  } catch (err) {
    // TODO: Print parse error to mws.
    console.warn('MWShell.handleInput(): esprima parse error:', err);
  }
  this.$input.val('');
};

MWShell.prototype.enableInput = function (bool) {
  this.$input.get(0).disabled = !bool;
};

$(document).ready(mongo.init);
