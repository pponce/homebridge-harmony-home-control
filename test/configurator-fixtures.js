import { project } from '../lib/configurator/model.js';
export function nativeFixture() {
  return {host:'192.0.2.70',accountId:'900',remoteId:'800',readAt:'2026-01-01T10:00:00.000Z',unavailable:[],resources:{
    DeviceList:{DevicesWithFeatures:[
      {Device:{'Id-':101,Name:'Living room display',Manufacturer:'Example',Model:'Display',Transport:'IR',InterDeviceDelay:500,InterKeyDelay:100,PressMinRepeats:1,SecretToken:'never-export-this'},Commands:[{Name:'PowerOn',Raw:'not-for-export'},{Name:'PowerOff'},{Name:'InputHdmi1'}],DeviceFeatures:[
        {__type:'PowerFeature',PowerTypeId:1,PowerOnDelay:1000,IsPowerAlwaysOn:false,IsPoweredOnBetweenActivities:true,PowerOnActions:[{__type:'IRPressAction',IRCommandName:'PowerOn',Order:0,Duration:0}],PowerOffActions:[{__type:'IRPressAction',IRCommandName:'PowerOff'}]},
        {__type:'InputFeature',InputType:'Discrete',InputDelay:500,Inputs:[{'Id-':201,InputName:'HDMI 1',InputOrder:1,Actions:[{__type:'IRPressAction',IRCommandName:'InputHdmi1'}]}]}
      ]},
      {Device:{'Id-':102,Name:'Game console',Manufacturer:'Nintendo',Model:'Switch'},Commands:[{Name:'Home'}],DeviceFeatures:[]}
    ]},
    ActivityList:{Activities:[{'Id-':401,Name:'Play a game',ActivityOrder:1,Type:'PlayGame',Roles:[{'Id-':301,__type:'DisplayActivityRole','DeviceId-':101,SelectedInput:{'Id-':201,Name:'HDMI 1'},PowerOnOrder:0,PowerOffOrder:1,NextDevicePowerOnDelay:500},{'Id-':302,__type:'PassThroughActivityRole','DeviceId-':102,PowerOnOrder:1,PowerOffOrder:0}],EnterActions:[{__type:'DelayAction',Order:0,Delay:500}],LeaveActions:[]}]},
    MapList:{ButtonMaps:[{'Id-':501,'ActivityId-':401,Buttons:[{ButtonKey:'VolumeUp',FunctionGroupType:'HardButton',ButtonAction:{__type:'ButtonCommandAction',CommandName:'VolumeUp','DeviceId-':101}}],Sequences:[]}]},
    FunctionList:{}
  }};
}
export const modelFixture = () => project(nativeFixture());
const common = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.Common.Contracts.Data';
const activityNS = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.Activity';
const id = (name,v) => `<a:${name}><b:Value>${v}</b:Value></a:${name}>`;
export const envelope = (name,inner='') => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${name}Response xmlns="http://tempuri.org/"><${name}Result>${inner}</${name}Result></${name}Response></s:Body></s:Envelope>`;
export const activityXml = (name='Play a game') => envelope('SimpleGetActivities',`<a:Activity xmlns:a="${activityNS}" xmlns:b="${common}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="urn:future"><a:ActivityOrder>1</a:ActivityOrder><a:Future z:mode="preserve">unchanged</a:Future>${id('Id',401)}<a:Name>${name}</a:Name><a:Roles><a:AbstractActivityRole i:type="a:DisplayActivityRole">${id('DeviceId',101)}${id('Id',301)}<a:PowerOffOrder>1</a:PowerOffOrder><a:PowerOnOrder>0</a:PowerOnOrder><a:SelectedInput>${id('Id',201)}<a:Name>HDMI 1</a:Name></a:SelectedInput></a:AbstractActivityRole></a:Roles></a:Activity>`);
export const householdXml = () => envelope('GetMyHousehold',`<Accounts><Account><Id><Value>901</Value></Id><Remotes><Remote><Id><Value>801</Value></Id></Remote></Remotes></Account><Account><Id><Value>900</Value></Id><Remotes><Remote><Id><Value>799</Value></Id></Remote><Remote><Id><Value>800</Value></Id></Remote></Remotes></Account></Accounts>`);
