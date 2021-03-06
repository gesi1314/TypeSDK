/**
 * Created by TypeSDK 2016/10/10.
 */
var crypto = require('crypto');
var request = require('request');
var merge = require('merge');
var logicCommon = require('./logicCommon.js');

function convertParamLogin(query, ret) {
    var org =
    {
        "id": "0"
        , "token": ""
        , "data": ""
        , "sign": ""
    };

    var cloned = merge(true, org);
    merge(cloned, query);

    for (var i in cloned) {
        //判断参数中是否该有的字段齐全
        if (org[i] == cloned[i] && i != "data" && i != "id") {
            return false;
        }

        //判断参数中是否有为空的字段
        if (0 == (cloned[i] + "").replace(/(^s*)|(s*$)/g, "").length && i != "data" && i != "id") {
            return false;
        }
    }

    ret.uid = cloned.id;
    ret.sign = cloned.token.split("|", 2)[0];
    ret.timestamp = cloned.token.split("|", 2)[1];

    return true;
}


function callChannelLogin(attrs, params, query, ret, retf,gattrs) {
    var osign = crypto.createHash('md5').update(query.uid + '&' + query.timestamp + '&' + attrs.secret_key).digest('hex');

    if (osign == query.sign) {
        //打点：验证成功
        logicCommon.sdkMonitorDot(logicCommon.dotType.LoginDot.ChVerifySuc);
        ret.code = 0;
        ret.msg = "NORMAL";
        ret.id = query.uid;
        ret.nick = "";
        ret.token = "";
        ret.value = '';
        logicCommon.createLoginLog(gattrs.id,attrs.channel_id,attrs.sdk_name,ret.id);
    }
    else {
        //打点：验证失败
        logicCommon.sdkMonitorDot(logicCommon.dotType.LoginDot.ChVerifyErr);
        ret.code = 1;
        ret.msg = "LOGIN User ERROR";
        ret.id = "";
        ret.nick = "";
        ret.token = "";
        ret.value = '';
    }
    retf(ret);
}


function callGamePay(attrs, gattrs, params, query, ret, retf, game, channel, channelId) {

    var retValue = {};
    retValue.code = 0;
    retValue.id = query.callbackInfo.split("|", 2)[1];
    retValue.order = query.orderId;
    retValue.cporder = query.callbackInfo.split("|", 2)[0];
    retValue.info = "";
    //console.log(retValue);
    logicCommon.getNotifyUrl(retValue.cporder, params, function (hasData) {
        if (!hasData) {
            //打点：其他支付失败
            logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
            retf('FAILURE');
        } else {
            retValue.sign = logicCommon.createSignPay(retValue, gattrs.gkey);

            retValue.gamename = game;
            retValue.sdkname = channel;
            retValue.channel_id = channelId;
            retValue.amount = '' + query.amount * 100 + '';

            logicCommon.UpdateOrderStatus(game, channel, retValue.cporder, retValue.order, 1, 0,query);

            var options = {
                url: params.out_url,
                method: params.method,
                body: retValue,
                json: true
            };
            console.log(options);

            //打点：支付回调通知
            logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.PayNotice);
            request(options, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    var retOut = body;

                    //日志记录CP端返回
                    console.log(retOut);
                    if (typeof retOut.code == 'undefined') {
                        //打点：其他支付失败
                        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
                        retf('FAILURE');
                        return;
                    }

                    if (retOut.code == 0) {
                        //打点：服务器正确处理支付成功回调
                        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.PaySuc);
                        logicCommon.UpdateOrderStatus(game,channel,retValue.cporder,retValue.order,4,query.amount* 100);
                        retf('SUCCESS');
                    }
                    else {
                        //打点：其他支付失败
                        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
                        retf('FAILURE');
                    }
                } else {
                    //打点：其他支付失败
                    logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
                    retf('FAILURE');
                }
            });
        }
    });
}

function checkSignPay(attrs, query) {

    console.log(query);

    var queryArr = new Array();
    var keyArr = new Array();

    for (var key in query) {
        queryArr[key] = query[key];
        keyArr.push(key);
    }

    keyArr.sort();
    console.log(keyArr);

    var signStr = "";
    for (var i = 0; i < keyArr.length; i++) {
        if (keyArr[i] != 'sign')
            signStr += keyArr[i] + "=" + queryArr[keyArr[i]];
    }
    console.log(signStr);

    signStr += attrs.secret_key;
    console.log(signStr);

    var osign = crypto.createHash('md5').update(signStr).digest('hex');

    console.log(query.sign + " :: " + osign);

    if (query.sign != osign) {
        return false;
    }

    return true;
}

function checkOrder() {
    return false;
}

/**
 * 核实外部订单号的唯一性
 * @param
 *      query   请求串Obj
 *      retf    返回校验结果 True 合法|False 不合法
 * */
function checkChOrder(game, channel,attrs, query, retf){
    var isIllegal = false;
    logicCommon.selCHOrderInRedis(channel,query.orderId,function(res){
        if(!res || typeof res == "undefined"){
            logicCommon.saveCHOrderInRedis(game, channel, query.callbackInfo.split("|", 2)[0], query.orderId,function(res){
                if(res && typeof res != "undefined"){
                    isIllegal = true;
                    retf(isIllegal);
                }else{
                    retf(isIllegal);
                }
            });
        }else{
            retf(isIllegal);
        }
    });
}

function compareOrder(attrs,gattrs,params,query,ret,game,channel,retf){
    var retValue = {};
    retValue.code = 0;
    retValue.id = query.callbackInfo.split("|", 2)[1];
    retValue.order = query.orderId;
    retValue.cporder = query.callbackInfo.split("|", 2)[0];
    retValue.info = "";
    logicCommon.getNotifyUrl(retValue.cporder,params,function(hasData) {
        if (!hasData) {
            retf('FAILURE');
            return;
        }
        else  if (query.app_order_id == params.orderdata && query.product_id == params.goodsid && query.amount >= params.goodsprice*0.9&&query.amount <= params.goodsprice)
        {
            var data  = {};
            data.code = '0000';
            data.msg = 'NORMAL';
            retf(data);
            return;
        }
        else {
            retValue.sign = logicCommon.createSignPay(retValue,gattrs.gkey);
            logicCommon.UpdateOrderStatus(game,channel,retValue.cporder,retValue.order,1,0,query);
            var options = {
                url: params.verifyurl,
                method: "POST",
                body: retValue,
                json: true
            };
            request(options, function (error, response, body) {
                if(!error && response.statusCode == 200){
                    var retOut = body;
                    if (typeof retOut.code == 'undefined'){
                        retf('FAILURE');
                        return;
                    }
                    if(retOut.code=='0'){
                        if(retOut.Itemid){
                            logicCommon.mapItemLists(attrs,retOut);
                        }
                        if(retValue.cporder==retOut.cporder
                            &&(query.amount)* 100>=retOut.amount*0.9
                            &&(query.amount)* 100<=retOut.amount){
                            if(retOut.status=='2'){
                                retf('FAILURE');
                                return;
                            }else if(retOut.status=='4'||retOut.status=='3'){
                                logicCommon.UpdateOrderStatus(game,channel,retValue.cporder,retValue.order,4,query.amount* 100);
                                retf('SUCCESS');
                                return;
                            }else{
                                logicCommon.UpdateOrderStatus(game,channel,retValue.cporder,retValue.order,2,0);
                                var data  = {};
                                data.code = '0000';
                                data.msg = 'NORMAL';
                                retf(data);
                                return;
                            }
                        }else{
                            logicCommon.UpdateOrderStatus(game,channel,retValue.cporder,retValue.order,3,0);
                            retf('FAILURE');
                            return;
                        }
                    }else{
                        retf('FAILURE');
                        return;
                    }
                }else{
                    retf('FAILURE');
                    return;
                }
            });
        }
    });
}

exports.convertParamLogin = convertParamLogin;
exports.callChannelLogin = callChannelLogin;
exports.checkSignPay = checkSignPay;
exports.callGamePay = callGamePay;
exports.checkOrder = checkOrder;
exports.checkChOrder = checkChOrder;
exports.compareOrder = compareOrder;