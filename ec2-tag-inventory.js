#!/usr/bin/env node
/* jshint node:true */
"use strict";

var fs = require('fs');

var opts = require("nomnom")
   .option('env', {
      abbr: 'e',
      default: 'beta',
      help: 'Environment'
   })
   .option('map', {
      abbr: 'm',
      help: 'Specify a role mapping file'
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
var hostsMeta = {};
ansibleGroups._meta = { hostvars: hostsMeta };

var roleMapping;
if(opts.map) {
  roleMapping = JSON.parse(fs.readFileSync(opts.map, 'utf-8'));
}


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

function createHostsMeta(instance) {
  return {
    ansible_ssh_host: instance.PrivateIpAddress
  };
}

function getRoleMappedGroups(role, env) {
  var result = ['all', 'shared-secrets'];
  if(env) {
    result.push(env + '-servers');
    result.push(env + '-secrets');
  }

  if(!roleMapping) return result;
  result = result.concat(roleMapping['all']);
  result = result.concat(roleMapping[role]);

  return result;
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
    var role = getTagValue(i.Tags, 'Role');
    var env = getTagValue(i.Tags, 'Env');

    hostsMeta[name] = createHostsMeta(i);

    if(name) {
      var uniqGroups = {};
      var groups = getGroups(i.Tags);
      var roleMappedGroups = getRoleMappedGroups(role, env);

      if(groups) {
        groups.forEach(function(g) {
          var group = g.trim();
          if(uniqGroups[group]) return;
          uniqGroups[group] = 1;

          addHostToGroup(group, name);
        });
      }

      roleMappedGroups.forEach(function(group) {
        if(uniqGroups[group]) return;
        uniqGroups[group] = 1;

        addHostToGroup(group, name);
      });


    }
  });


  console.log(JSON.stringify(ansibleGroups, null, " "));
});

function die(err) {
  console.error(err);
  console.error(err.stack);
  process.exit(1);
}
