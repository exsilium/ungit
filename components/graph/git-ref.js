var ko = require('knockout');
var md5 = require('blueimp-md5').md5;
var Selectable = require('./selectable');
var programEvents = require('ungit-program-events');
var components = require('ungit-components');

var RefViewModel = function(fullRefName, graph) {
  var self = this;
  Selectable.call(this, graph);
  this.graph = graph;
  this.name = fullRefName;
  this.node = ko.observable();
  this.localRefName = this.name; // origin/master or master
  this.refName = this.name; // master
  this.isRemoteTag = this.name.indexOf('remote-tag: ') == 0;
  this.isLocalTag = this.name.indexOf('tag: ') == 0;
  this.isTag = this.isLocalTag || this.isRemoteTag;
  var isRemoteBranchOrHEAD = this.name.indexOf('refs/remotes/') == 0;
  this.isLocalHEAD = this.name == 'HEAD';
  this.isRemoteHEAD = this.name.indexOf('/HEAD') != -1;
  this.isLocalBranch = this.name.indexOf('refs/heads/') == 0;
  this.isRemoteBranch = isRemoteBranchOrHEAD && !this.isRemoteHEAD;
  this.isStash = this.name.indexOf('refs/stash') == 0;
  this.isHEAD = this.isLocalHEAD || this.isRemoteHEAD;
  this.isBranch = this.isLocalBranch || this.isRemoteBranch;
  this.isRemote = isRemoteBranchOrHEAD || this.isRemoteTag;
  this.isLocal = this.isLocalBranch || this.isLocalTag;
  if (this.isLocalBranch) {
    this.localRefName = this.name.slice('refs/heads/'.length);
    this.refName = this.localRefName;
  }
  if (this.isRemoteBranch) {
    this.localRefName = this.name.slice('refs/remotes/'.length);
  }
  if (this.isLocalTag) {
    this.localRefName = this.name.slice('tag: refs/tags/'.length);
    this.refName = this.localRefName;
  }
  if (this.isRemoteTag) {
    this.localRefName = this.name.slice('remote-tag: '.length);
  }
  if (this.isRemote) {
    // get rid of the origin/ part of origin/branchname
    var s = this.localRefName.split('/');
    this.remote = s[0];
    this.refName = s.slice(1).join('/');
  }
  this.show = true;
  this.server = this.graph.server;
  this.localRef = ko.observable();
  this.isDragging = ko.observable(false);
  this.current = ko.computed(function() {
    return self.isLocalBranch && self.graph.checkedOutBranch() == self.refName;
  });
  this.color = this._colorFromHashOfString(this.name);
  
  this.node.subscribe(function(oldNode) {
    if (oldNode) oldNode.branchesAndLocalTags.remove(self);
  }, null, "beforeChange");
};
module.exports = RefViewModel;

RefViewModel.prototype._colorFromHashOfString = function(string) {
  return '#' + md5(string).toString().slice(0, 6);
}
RefViewModel.prototype.dragStart = function() {
  this.graph.currentActionContext(this);
  this.isDragging(true);
  if (document.activeElement) document.activeElement.blur();
}
RefViewModel.prototype.dragEnd = function() {
  this.graph.currentActionContext(null);
  this.isDragging(false);
}
RefViewModel.prototype.moveTo = function(target, callback) {
  var self = this;
  
  var callbackWithRefSet = function(err, res) {
    if (err) {
      callback(err, res);
    } else {
      // correctly re locate references for target node and this ref.
      var targetNode = self.graph.getNode(target);
      
      if (self.isRemoteTag) {
        targetNode.remoteTags.push(self);
      } else {
        targetNode.branchesAndLocalTags.push(self);
      }
      
      self.node(targetNode);
      callback();
    }
  }
  
  if (this.isLocal) {
    if (this.current()) {
      this.server.post('/reset', { path: this.graph.repoPath, to: target, mode: 'hard' }, callbackWithRefSet);
    } else if (this.isTag) {
      this.server.post('/tags', { path: this.graph.repoPath, name: this.refName, startPoint: target, force: true }, callbackWithRefSet);
    } else {
      this.server.post('/branches', { path: this.graph.repoPath, name: this.refName, startPoint: target, force: true }, callbackWithRefSet);
    }
  } else {
    var pushReq = { path: this.graph.repoPath, remote: this.remote, refSpec: target, remoteBranch: this.refName };
    this.server.post('/push', pushReq, function(err, res) {
        if (err) {
          if (err.errorCode == 'non-fast-forward') {
            var forcePushDialog = components.create('yesnodialog', { title: 'Force push?', details: 'The remote branch can\'t be fast-forwarded.' });
            forcePushDialog.closed.add(function() {
              if (!forcePushDialog.result()) return callback();
              pushReq.force = true;
              self.server.post('/push', pushReq, callback);
            });
            programEvents.dispatch({ event: 'request-show-dialog', dialog: forcePushDialog });
            return true;
          }
        }
        callbackWithRefSet(err, res);
      });
  }
}
