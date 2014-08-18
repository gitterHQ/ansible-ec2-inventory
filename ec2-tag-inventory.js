#!/usr/bin/env node
/* jshint node:true */
"use strict";

var opts = require("nomnom")
   .option('env', {
      abbr: 'e',
      default: 'beta',
      help: 'Environment'
   })
   .option('list', {
      flag: true
   })
   .option('region', {
      abbr: 'r',
      default: 'us-east-1',
      help: 'AWS Region'
   })
   .parse();

var AWS = require('aws-sdk');
var credentials = new AWS.SharedIniFileCredentials({ });
AWS.config.credentials = credentials;
AWS.config.update({region: opts.region });

var ec2 = new AWS.EC2({ });

var ansibleGroups = {};

function getTagValue(tags, Name) {
  var tag = tags.filter(function(t) {
    return t.Key === Name;
  })[0];

  return tag && tag.Value;
}

function getGroups(tags) {
  return tags.filter(function(t) {
    return (/^AnsibleGroups:\d+$/).test(t.Key);
  }).map(function(t) {
    return t.Value;
  }).join(',').split(',');
}

function addHostToGroup(group, host) {
  if(ansibleGroups[group]) {
    ansibleGroups[group].push(host);
  } else {
    ansibleGroups[group] = [host];
  }
}

ec2.describeInstances({}, function(err, result) {
  if(err) return die(err);

  var instances = [];
  result.Reservations.forEach(function(reservation) {
    instances = instances.concat(reservation.Instances);
  });

  instances = instances.filter(function(i) {
    var env = getTagValue(i.Tags, 'Env');
    return env === opts.env;
  });

  instances.forEach(function(i) {
    var name = getTagValue(i.Tags, 'Name');
    var groups = getGroups(i.Tags);
    if(name) {
      addHostToGroup('all', name);

      if(groups) {
        groups.forEach(function(g) {
          addHostToGroup(g.trim(), name);
        });
      }
    }
  });

  console.log(JSON.stringify(ansibleGroups, null, " "));
});

function die(err) {
  console.error(err);
  console.error(err.stack);
  process.exit(1);
}
