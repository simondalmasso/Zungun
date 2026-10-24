(function(root){
  'use strict';
  function connectionState(mode,label,connected){
    if(mode==='SATELLITE_ONLY'&&label==='Conectado')return {label:'Satélite no verificado',connected:false};
    return {label,connected:Boolean(connected)};
  }
  function allowsInternetSend(mode,online){
    return mode!=='SATELLITE_ONLY'&&Boolean(online);
  }
  root.ZungunTransportGuards={connectionState,allowsInternetSend};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ZungunTransportGuards;
})(typeof window!=='undefined'?window:globalThis);
