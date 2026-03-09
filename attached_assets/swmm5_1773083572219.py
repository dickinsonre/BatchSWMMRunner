"""Python SWMM5 interface"""

import ctypes
import platform
import datetime

_plat= platform.system()
if _plat=='Linux':
    _lib = ctypes.CDLL("libswmm5.so")
elif _plat=='Windows':
    _lib = ctypes.WinDLL(".\swmm5.dll")
else:
    Exception('Platform '+ _plat +' unsupported')

def getVersion():
    return _lib.swmm_getVersion()

def run(f1, f2, f3 = ''):
    return _lib.swmm_run(ctypes.c_char_p(f1.encode()), 
                        ctypes.c_char_p(f2.encode()), 
                        ctypes.c_char_p(f3.encode()))

def open(f1, f2, f3 = ''):
    return _lib.swmm_open(ctypes.c_char_p(f1.encode()), 
                        ctypes.c_char_p(f2.encode()), 
                        ctypes.c_char_p(f3.encode()))

def start(saveFlag):
    return _lib.swmm_start(ctypes.c_int(saveFlag))

def step():
    elapsed_time = ctypes.c_double()
    _lib.swmm_step(ctypes.byref(elapsed_time))
    return elapsed_time.value

def stride(strideStep):
    elapsed_time = ctypes.c_double()
    _lib.swmm_stride(ctypes.c_int(strideStep), ctypes.byref(elapsed_time))
    return elapsed_time.value

def end():
    _lib.swmm_end()

def getMassBalErr():     
    runoff = ctypes.c_float()
    flow = ctypes.c_float()
    qual = ctypes.c_float()
    _lib.swmm_getMassBalErr(
        ctypes.byref(runoff), ctypes.byref(flow), ctypes.byref(qual))
    return runoff.value, flow.value, qual.value

def report():
    return _lib.swmm_report()

def close():
  _lib.swmm_close()

def getWarnings():
    return _lib.swmm_getWarnings()

def getError():
    errmsg = ctypes.create_string_buffer(240)
    _lib.swmm_getError(ctypes.byref(errmsg), ctypes.c_int(240))
    return errmsg.value.decode()

def getCount(objtype):
    return _lib.swmm_getCount(ctypes.c_int(objtype))

def getName(objtype, index, size):
    name = ctypes.create_string_buffer(size)
    _lib.swmm_getName(
        ctypes.c_int(objtype), ctypes.c_int(index), ctypes.byref(name), ctypes.c_int(size))
    return name.value.decode()

def getIndex(objtype, name):
    return _lib.swmm_getIndex(ctypes.c_int(objtype), ctypes.c_char_p(name.encode()))

def getValue(property, index):
    _lib.swmm_getValue.restype = ctypes.c_double   
    return _lib.swmm_getValue(ctypes.c_int(property), ctypes.c_int(index))

def getSavedValue(property, index, period):
    _lib.swmm_getSavedValue.restype = ctypes.c_double   
    return _lib.swmm_getSavedValue(
        ctypes.c_int(property), ctypes.c_int(index), ctypes.c_int(period))

def setValue(property, index, value):
    _lib.swmm_setValue(
        ctypes.c_int(property), ctypes.c_int(index), ctypes.c_double(value))

def writeLine(line):
    _lib.swmm_writeLine(ctypes.c_char_p(line.encode()))

def decodeDate(date):

    """  Decodes a SWMM DateTime value to a Python DateTime value. """
    """  Use Python's datetime.weekday()  method to get day of week """
    """  (where Monday = 0 and Sunday = 6) if needed. """

    year= ctypes.c_int()
    month= ctypes.c_int()
    day= ctypes.c_int()
    hour= ctypes.c_int()
    minute= ctypes.c_int()
    second= ctypes.c_int()
    dayofweek= ctypes.c_int()
    _lib.swmm_decodeDate(
        ctypes.c_double(date), ctypes.byref(year), ctypes.byref(month),
        ctypes.byref(day),  ctypes.byref(hour), ctypes.byref(minute),
        ctypes.byref(second), ctypes.byref(dayofweek))
    d = datetime.datetime(
        year.value, month.value, day.value, hour.value, minute.value, second.value)
    return d

GAGE     = 0
SUBCATCH = 1
NODE     = 2
LINK     = 3
SYSTEM   = 100

JUNCTION = 0
OUTFALL  = 1
STORAGE  = 2
DIVIDER  = 3

CONDUIT = 0
PUMP    = 1
ORIFICE = 2
WEIR    = 3
OUTLET  = 4

GAGE_RAINFALL = 100

SUBCATCH_AREA      = 200
SUBCATCH_RAINGAGE  = 201
SUBCATCH_RAINFALL  = 202
SUBCATCH_EVAP      = 203
SUBCATCH_INFIL     = 204
SUBCATCH_RUNOFF    = 205
SUBCATCH_RPTFLAG   = 206

NODE_TYPE     = 300
NODE_ELEV     = 301
NODE_MAXDEPTH = 302
NODE_DEPTH    = 303
NODE_HEAD     = 304
NODE_VOLUME   = 305
NODE_LATFLOW  = 306
NODE_INFLOW   = 307
NODE_OVERFLOW = 308
NODE_RPTFLAG  = 309

LINK_TYPE       = 400
LINK_NODE1      = 401
LINK_NODE2      = 402
LINK_LENGTH     = 403
LINK_SLOPE      = 404
LINK_FULLDEPTH  = 405
LINK_FULLFLOW   = 406
LINK_SETTING    = 407
LINK_TIMEOPEN   = 408
LINK_TIMECLOSED = 409
LINK_FLOW       = 410
LINK_DEPTH      = 411
LINK_VELOCITY   = 412
LINK_TOPWIDTH   = 413
LINK_RPTFLAG    = 414

STARTDATE    = 0
CURRENTDATE  = 1
ELAPSEDTIME  = 2
ROUTESTEP    = 3
MAXROUTESTEP = 4
REPORTSTEP   = 5
TOTALSTEPS   = 6
NOREPORT     = 7
FLOWUNITS    = 8

CFS = 0
GPM = 1
MGD = 2
CMS = 3
LPS = 4
MLD = 5
