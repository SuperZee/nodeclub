/*!
 * nodeclub - site index controller.
 * Copyright(c) 2012 fengmk2 <fengmk2@gmail.com>
 * Copyright(c) 2012 muyuan
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var User = require('../proxy').User;
var Topic = require('../proxy').Topic;
var config = require('../config');
var eventproxy = require('eventproxy');
var cache = require('../common/cache'); // 设置和取redis
var xmlbuilder = require('xmlbuilder');
var renderHelper = require('../common/render_helper');
var _ = require('lodash');

// 网站首页 url:'/' √√√√√
exports.index = function (req, res, next) {
    // 获取body url查询参数 /?page=Number() 首页分页使用的参数,
    // 字符串转数字,并且如果转换出错返回1,默认第一页
    var page = parseInt(req.query.page, 10) || 1;
    page = page > 0 ? page : 1; // 如果数字小于等于0,则转换成1
    var tab = req.query.tab || 'all'; // 首页的tab , 全部,精华,分享,问答,招聘

    var proxy = new eventproxy();
    proxy.fail(next);

    // 取主题
    var query = {};
    if (tab && tab !== 'all') { // tab存在且tab不等于all
        if (tab === 'good') { // tab等于good
            query.good = true; /* 为什么要设置true ? */
        } else {
            query.tab = tab;
        }
    }

    var limit = config.list_topic_count; // 配置文件中限制的一页展示多少条数据
    // 查询参数,skip:跳过的条数,limit:查询限制的条数,sort:排序置顶优先级最高,其次是最后回复的
    var options = {
        skip: (page - 1) * limit,
        limit: limit,
        sort: '-top -last_reply_at'
    };
    // proxy的Topic,执行数据库查询,第三个参数是callback,完成后触发topics,
    // 下面代码有一个proxy.all来监听
    // proxy.done(),可以看成proxy.emit()的高级版
    Topic.getTopicsByQuery(query, options, proxy.done('topics', function (topics) {
        return topics;
        /*
        ep.done('tpl', function (tpl) {
          // 将内容更改后，返回即可
          return tpl.trim();
        });
         */
    }));

    // 取排行榜上的用户
    cache.get('tops', proxy.done(function (tops) {
        if (tops) {
            proxy.emit('tops', tops);
        } else {
            User.getUsersByQuery({
                    is_block: false
                }, {
                    limit: 10,
                    sort: '-score'
                },
                proxy.done('tops', function (tops) {
                    cache.set('tops', tops, 60 * 1); // 每60秒查一次排行榜,并且存在redis中
                    return tops;
                })
            );
        }
    }));
    // END 取排行榜上的用户

    // 取0回复的主题
    cache.get('no_reply_topics', proxy.done(function (no_reply_topics) {
        if (no_reply_topics) {
            proxy.emit('no_reply_topics', no_reply_topics);
        } else {
            Topic.getTopicsByQuery({
                    reply_count: 0,
                    tab: {
                        $ne: 'job'
                    }
                }, {
                    limit: 5,
                    sort: '-create_at'
                },
                proxy.done('no_reply_topics', function (no_reply_topics) {
                    cache.set('no_reply_topics', no_reply_topics, 60 * 1);
                    return no_reply_topics;
                }));
        }
    }));
    // END 取0回复的主题

    // 取分页数据
    var pagesCacheKey = JSON.stringify(query) + 'pages';
    cache.get(pagesCacheKey, proxy.done(function (pages) {
        if (pages) {
            proxy.emit('pages', pages);
        } else {
            Topic.getCountByQuery(query, proxy.done(function (all_topics_count) {
                var pages = Math.ceil(all_topics_count / limit);
                cache.set(pagesCacheKey, pages, 60 * 1);
                proxy.emit('pages', pages);
            }));
        }
    }));
    // END 取分页数据

    var tabName = renderHelper.tabName(tab); // 得到tabName
    proxy.all('topics', 'tops', 'no_reply_topics', 'pages',
        function (topics, tops, no_reply_topics, pages) {
            res.render('index', { // 以上所有事件触发,执行render函数
                topics: topics,
                current_page: page,
                list_topic_count: limit,
                tops: tops,
                no_reply_topics: no_reply_topics,
                pages: pages,
                tabs: config.tabs,
                tab: tab,
                pageTitle: tabName && (tabName + '版块'),
            });
        });
};

// 站map
exports.sitemap = function (req, res, next) {
    var urlset = xmlbuilder.create('urlset', {
        version: '1.0',
        encoding: 'UTF-8'
    });
    urlset.att('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9');

    var ep = new eventproxy();
    ep.fail(next);

    ep.all('sitemap', function (sitemap) {
        res.type('xml');
        res.send(sitemap);
    });

    cache.get('sitemap', ep.done(function (sitemapData) {
        if (sitemapData) {
            ep.emit('sitemap', sitemapData);
        } else {
            Topic.getLimit5w(function (err, topics) {
                if (err) {
                    return next(err);
                }
                topics.forEach(function (topic) {
                    urlset.ele('url').ele('loc', 'http://cnodejs.org/topic/' + topic._id);
                });

                var sitemapData = urlset.end();
                // 缓存一天
                cache.set('sitemap', sitemapData, 3600 * 24);
                ep.emit('sitemap', sitemapData);
            });
        }
    }));
};

exports.appDownload = function (req, res, next) {
    res.redirect('https://github.com/soliury/noder-react-native/blob/master/README.md')
};
