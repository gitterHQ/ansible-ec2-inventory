#!/usr/bin/env node
/* jshint node:true */
"use strict";

var ini = require('ini');
var fs = require('fs');

var hosts = {};

var opts = require("nomnom")
   .option('config', {
      abbr: 'c',
      help: 'Config file to parse'
   })
   .option('region', {
      abbr: 'r',
      default: 'us-east-1',
      help: 'AWS Region'
   })
   .parse();

var config = ini.parse(fs.readFileSync(opts.config, 'utf-8'));

function getTagValue(tags, Name) {
  var tag = tags.filter(function(t) {
    return t.Key === Name;
  })[0];

  return tag && tag.Value;
}

Object.keys(config).forEach(function(section) {
  var sectionData = config[section];

  if(section.indexOf(':') < 0) {
    Object.keys(sectionData).forEach(function(hostname) {
      if(hosts[hostname]) {
        hosts[hostname].push(section);
      } else {
        hosts[hostname] = [section];
      }
    });
  }

  if(section.indexOf(':children') >= 0) {
    var additionalGroupName = section.substr(0, section.indexOf(':children'));

    Object.keys(sectionData).forEach(function(group) {
      var g = config[group];
      if(!g) return;

      Object.keys(g).forEach(function(hostname) {
        if(hosts[hostname]) {
          hosts[hostname].push(additionalGroupName);
        } else {
          hosts[hostname] = [additionalGroupName];
        }
      });

    });
  }

});

var AWS = require('aws-sdk');
var credentials = new AWS.SharedIniFileCredentials({ });
AWS.config.credentials = credentials;
AWS.config.update({region: opts.region });

var ec2 = new AWS.EC2({ });
ec2.describeInstances({}, function(err, result) {

  var instances = [];
  result.Reservations.forEach(function(reservation) {
    instances = instances.concat(reservation.Instances);
  });

  var ec2HostInfo = {};

  instances.forEach(function(i) {
    var name = getTagValue(i.Tags, 'Name');
    if(name) {
      ec2HostInfo[name] = i;
    }
  });

  Object.keys(hosts).forEach(function(host) {
    var groups = hosts[host];
    groups.sort();

    var lists = [];
    var groupList = "";

    groups.forEach(function(group) {
      var newGroupList = groupList ? groupList + "," + group : group;
      if(newGroupList.length >= 255) {
        lists.push(groupList);
        groupList = "";
      } else {
        groupList = newGroupList;
      }
    });

    if(groupList) {
      lists.push(groupList);
    }
    var instance = ec2HostInfo[host];

    if(!instance) die(new Error("Instance not found " + host));

    ec2.createTags({
      Resources: [instance.InstanceId],
      Tags: lists.map(function(list, index) {
        return { Key: 'AnsibleGroups:' + index, Value: list };
      })
    }, function(err) {
      if(err) die(err);

      console.log(instance.InstanceId, lists.map(function(list, index) {
        return { Key: 'AnsibleGroups:' + index, Value: list };
      }));

    });

  });
});

function die(err) {
  console.error(err);
  console.error(err.stack);
  process.exit(1);
}
// console.log(JSON.stringify(hosts, null, "  "));
