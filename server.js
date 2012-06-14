/*!
 * node-parserproxy - A JSON-over-HTTP proxy for node-feedparser and node-opmlparser
 * Copyright(c) 2011 Dan MacTough <danmactough@gmail.com>
 * All rights reserved.
 */

/**
 * Module dependencies.
 */
var http = require('http')
  , url = require('url')
  , request = require('request')
  , FeedParser = require('feedparser')
  , OpmlParser = require('opmlparser')
  ;

if (!module.parent) {

  var config = {};
  try {
    config = require('./config');
  } catch(e) { };

  var port = process.env['PARSER_PROXY_PORT'] || config.port || 3030
    , timeout = process.env['PARSER_PROXY_TIMEOUT'] || config.timeout || 3000
    , externalUri = config.url || 'localhost:'+port;

  process.on('uncaughtException', function (err) {
    console.error('Caught exception: ' + err);
  });

  var server = http.createServer(function (req, res) {
    var data = '';
    req.body = {};
    req.urlObj = url.parse(req.url, true);

    req.on('data', function (buffer){
      data += (buffer.toString('utf8'));
    });

    req.on('end', function (){

      if (req.method != 'POST' && req.method != 'GET') {
        res.statusCode = 501; // Not implemented
        return res.end();
      }

      if (req.headers['content-type'] == 'application/json') {
        try {
          req.body = JSON.parse(data);
        } catch(e) {
          console.error(e.message);
          res.statusCode = 400;
          return res.end();
        }
      } else if (req.headers['content-type'] == 'application/xml' ||
                 req.headers['content-type'] == 'text/xml' ||
                 req.headers['content-type'] == 'text/x-opml' ||
                 req.headers['content-type'] == 'application/rss+xml') {
        req.body = data;
      } else if (req.method == 'GET') {
        req.body = req.urlObj.query;
      } else {
        res.statusCode = 501; // Not implemented
        return res.end();
      }

      function _parse (parser, string, response, callback){
        if (typeof response == 'function') {
          callback = response;
          response = null;
        }
        if (response) {
          parser.parseString(string, function (err, meta, articles_or_feeds, outline){
            if (err) {
              console.error(err.message);
              callback(err);
            } else {
              meta.response = { headers: response.headers,
                                statusCode: response.statusCode,
                                request: { uri: response.request.uri,
                                           redirects: response.request.redirects} };
              if (!outline) callback(null, meta, articles_or_feeds);
              else callback(null, meta, articles_or_feeds, outline);
            }
          });
        } else {
          parser.parseString(string, callback);
        }
      }

      function _request (parser, req, callback){
        var url = req.url || req.uri;
        console.log('%s - Fetching %s', new Date(), url);
        request({ uri: url, timeout: timeout }, function (err, response, body){
          if (err) {
            console.error(err.message);
            callback(err);
          } else if (response.statusCode >= 400) {
            console.error('HTTP Request Error: %s', response.statusCode);
            callback(response.statusCode);
          }
          else _parse(parser, body, response, callback);
        });
      }

      switch (req.urlObj.pathname) {
        case '/parseFeed':
          var parser = new FeedParser()
            , respond = function (err, meta, articles){
                if (err) {
                  if (+err >= 400) {
                    res.statusCode = err;
                  } else {
                    res.writeHead(500, err.message || err);
                  }
                  res.end();
                } else {
                  res.writeHead(200, {'Content-Type': 'application/json'});
                  res.end(JSON.stringify({ meta: meta, articles: articles }));
                }
              };

          if (typeof req.body == 'string') _parse(parser, req.body, respond);
          else if ('url' in req.body || 'uri' in req.body) _request(parser, req.body, respond);
          else {
            res.statusCode = 400;
            res.end();
          }

          break;
        case '/parseOpml':
          var parser = new OpmlParser()
            , respond = function (err, meta, feeds, outline){
                if (err) {
                  if (+err >= 400) {
                    res.statusCode = err;
                  } else {
                    res.writeHead(500, err.message || err);
                  }
                  res.end();
                } else {
                  res.writeHead(200, {'Content-Type': 'application/json'});
                  res.end(JSON.stringify({ meta: meta, feeds: feeds, outline: outline }));
                }
              };

          if (typeof req.body == 'string') _parse(parser, req.body, respond);
          else if ('url' in req.body || 'uri' in req.body) _request(parser, req.body, respond);
          else {
            res.statusCode = 400;
            res.end();
          }

          break;
        case '/': // A short usage message
          res.writeHead(200, {'Content-Type': 'text/plain'});
          res.write('Welcome. Parserproxy has two API endpoints.\n');
          res.write('/parseFeed and /parseOpml\n');
          res.write('You may pass a url to fetch and parse via query string parameter or by posting a JSON object.\n');
          res.write('Ex. http://'+externalUri+'/parseFeed?url=http://cyber.law.harvard.edu/rss/examples/rss2sample.xml\n');
          res.write('Alternatively, you may post the contents of the feed or OPML to parse.\n');
          res.write('See https://github.com/danmactough/node-parserproxy for more info.\n');
          res.end();
        default:
          res.statusCode = 501; // Not implemented
          res.end();
          break;
      }
    });

    req.on('error', function (err){
      console.error(err.message);
      res.writeHead(500, err.message || err);
      res.end();
    });
  }).listen(port, function(){
    console.log("Proxy parser server listening on port %d", port);
  });
} else {
  module.exports = __dirname + '/server.js';
}
