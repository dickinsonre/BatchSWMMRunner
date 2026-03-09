unit swmm5;

{ Pascal SWMM 5 Interface }

interface

const
swmm_GAGE     = 0;
swmm_SUBCATCH = 1;
swmm_NODE     = 2;
swmm_LINK     = 3;
swmm_SYSTEM   = 100;

swmm_JUNCTION = 0;
swmm_OUTFALL  = 1;
swmm_STORAGE  = 2;
swmm_DIVIDER  = 3;

swmm_CONDUIT = 0;
swmm_PUMP    = 1;
swmm_ORIFICE = 2;
swmm_WEIR    = 3;
swmm_OUTLET  = 4;

swmm_GAGE_RAINFALL = 100;

swmm_SUBCATCH_AREA      = 200;
swmm_SUBCATCH_RAINGAGE  = 201;
swmm_SUBCATCH_RAINFALL  = 202;
swmm_SUBCATCH_EVAP      = 203;
swmm_SUBCATCH_INFIL     = 204;
swmm_SUBCATCH_RUNOFF    = 205;
swmm_SUBCATCH_RPTFLAG   = 206;

swmm_NODE_TYPE     = 300;
swmm_NODE_ELEV     = 301;
swmm_NODE_MAXDEPTH = 302;
swmm_NODE_DEPTH    = 303;
swmm_NODE_HEAD     = 304;
swmm_NODE_VOLUME   = 305;
swmm_NODE_LATFLOW  = 306;
swmm_NODE_INFLOW   = 307;
swmm_NODE_OVERFLOW = 308;
swmm_NODE_RPTFLAG  = 309;

swmm_LINK_TYPE       = 400;
swmm_LINK_NODE1      = 401;
swmm_LINK_NODE2      = 402;
swmm_LINK_LENGTH     = 403;
swmm_LINK_SLOPE      = 404;
swmm_LINK_FULLDEPTH  = 405;
swmm_LINK_FULLFLOW   = 406;
swmm_LINK_SETTING    = 407;
swmm_LINK_TIMEOPEN   = 408;
swmm_LINK_TIMECLOSED = 409;
swmm_LINK_FLOW       = 410;
swmm_LINK_DEPTH      = 411;
swmm_LINK_VELOCITY   = 412;
swmm_LINK_TOPWIDTH   = 413;
swmm_LINK_RPTFLAG    = 414;

swmm_STARTDATE    = 0;
swmm_CURRENTDATE  = 1;
swmm_ELAPSEDTIME  = 2;
swmm_ROUTESTEP    = 3;
swmm_MAXROUTESTEP = 4;
swmm_REPORTSTEP   = 5;
swmm_TOTALSTEPS   = 6;
swmm_NOREPORT     = 7;
swmm_FLOWUNITS    = 8;

swmm_CFS = 0;
swmm_GPM = 1;
swmm_MGD = 2;
swmm_CMS = 3;
swmm_LPS = 4;
swmm_MLD = 5;

Swmm5Lib = 'swmm5.dll';

function   swmm_run(F1: PAnsiChar; F2: PAnsiChar; F3: PAnsiChar): Integer; stdcall; external Swmm5Lib;
function   swmm_open(F1: PAnsiChar; F2: PAnsiChar; F3: PAnsiChar): Integer; stdcall; external Swmm5Lib;
function   swmm_start(SaveFlag: Integer): Integer; stdcall; external Swmm5Lib;
function   swmm_step(var ElapsedTime: Double): Integer; stdcall; external Swmm5Lib;
function   swmm_stride(StrideStep: Integer; var ElapsedTime: Double): Integer; stdcall; external Swmm5Lib;
function   swmm_end: Integer; stdcall; external Swmm5Lib;
function   swmm_report: Integer; stdcall; external Swmm5Lib;
function   swmm_close: Integer; stdcall; external Swmm5Lib;

function   swmm_getMassBalErr(var Erunoff: Single; var Eflow: Single; var Equal: Single): Integer; stdcall; external Swmm5Lib;
function   swmm_getVersion: Integer; stdcall; external Swmm5Lib;
function   swmm_getError(ErrMsg: PAnsiChar; MsgLen: Integer): Integer; stdcall; external Swmm5Lib;
function   swmm_getWarnings: Integer; stdcall; external Swmm5Lib;

function   swmm_getCount(ObjType: Integer): Integer; stdcall; external Swmm5Lib;
procedure  swmm_getName(ObjType: Integer; Index: Integer; Name: PAnsiChar; Size: Integer); stdcall; external Swmm5Lib;
function   swmm_getIndex(ObjType: Integer; Name: PAnsiChar): Integer; stdcall; external Swmm5Lib;
function   swmm_getValue(aProperty: Integer; Index: Integer): Double; stdcall; external Swmm5Lib;
procedure  swmm_setValue(aProperty: Integer; Index: Integer;  Value: Double); stdcall; external Swmm5Lib;
function   swmm_getSavedValue(aProperty: Integer; Index: Integer; Period: Integer): Double; stdcall; external Swmm5Lib;
procedure  swmm_writeLine(Line: PAnsiChar); stdcall; external Swmm5Lib;
procedure swmm_decodeDate(Date: Double; var Year: Integer; var Month: Integer; var Day: Integer; var Hour: Integer; var Minute: Integer; var Second: Integer; var DayOfWeek: Integer); stdcall; external Swmm5Lib;

implementation

end.
