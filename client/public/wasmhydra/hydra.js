let wasm_bindgen = (function(exports) {
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }

    /**
     * A model opened and ready to run.
     *
     * Drive it by calling [`HydraRun::advance`] until the progress it returns
     * reports `done`, painting between calls. See [`run`] for why the caller
     * sets the pace rather than the engine.
     */
    class HydraRun {
        static __wrap(ptr) {
            ptr = ptr >>> 0;
            const obj = Object.create(HydraRun.prototype);
            obj.__wbg_ptr = ptr;
            HydraRunFinalization.register(obj, obj.__wbg_ptr, obj);
            return obj;
        }
        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            HydraRunFinalization.unregister(this);
            return ptr;
        }
        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_hydrarun_free(ptr, 0);
        }
        /**
         * Advance by at most `max_steps` engine steps, returning the progress
         * as JSON. Returns early at a phase boundary or on completion.
         * @param {number} max_steps
         * @returns {string}
         */
        advance(max_steps) {
            let deferred2_0;
            let deferred2_1;
            try {
                const ret = wasm.hydrarun_advance(this.__wbg_ptr, max_steps);
                var ptr1 = ret[0];
                var len1 = ret[1];
                if (ret[3]) {
                    ptr1 = 0; len1 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * The line a finished phase leaves behind, replacing its progress line.
         *
         * Takes the phase name rather than reading the current one: this is
         * called at a boundary, where the run has already moved on and the
         * current phase is the *next* one.
         * @param {string} phase
         * @param {number} wall_seconds
         * @returns {string}
         */
        doneLine(phase, wall_seconds) {
            let deferred2_0;
            let deferred2_1;
            try {
                const ptr0 = passStringToWasm0(phase, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.hydrarun_doneLine(this.__wbg_ptr, ptr0, len0, wall_seconds);
                deferred2_0 = ret[0];
                deferred2_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * Total simulated duration (s).
         * @returns {number}
         */
        get duration() {
            const ret = wasm.hydrarun_duration(this.__wbg_ptr);
            return ret;
        }
        /**
         * The key of the engine that owns this model (`"wds"`, `"uds"`).
         * @returns {string}
         */
        get engineKey() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.hydrarun_engineKey(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * That engine's human-facing label.
         * @returns {string}
         */
        get engineLabel() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.hydrarun_engineLabel(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * The hotstart file the model asked to save, once the run has
         * finished. `undefined` when it declared none.
         * @returns {Uint8Array | undefined}
         */
        hotstartBytes() {
            const ret = wasm.hydrarun_hotstartBytes(this.__wbg_ptr);
            let v1;
            if (ret[0] !== 0) {
                v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
                wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            }
            return v1;
        }
        /**
         * The name the model declared that hotstart file under — what the same
         * run writes at a terminal, and so what the download should be called.
         * @returns {string | undefined}
         */
        get hotstartName() {
            const ret = wasm.hydrarun_hotstartName(this.__wbg_ptr);
            let v1;
            if (ret[0] !== 0) {
                v1 = getStringFromWasm0(ret[0], ret[1]).slice();
                wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            }
            return v1;
        }
        /**
         * Open the model described by `options`.
         *
         * Rejects with the CLI's diagnostics as a JSON string: `{"exit":1,
         * "diagnostics":[…]}`.
         * @param {RunOptions} options
         * @returns {HydraRun}
         */
        static open(options) {
            _assertClass(options, RunOptions);
            const ret = wasm.hydrarun_open(options.__wbg_ptr);
            if (ret[2]) {
                throw takeFromExternrefTable0(ret[1]);
            }
            return HydraRun.__wrap(ret[0]);
        }
        /**
         * Where the run is, as JSON, without advancing it.
         * @returns {string}
         */
        get progress() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.hydrarun_progress(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * The CLI's progress line for where the run currently is.
         *
         * `wall_seconds` is how long the current phase has been running, which
         * the caller measures — there is no clock on this side of the boundary.
         * @param {number} wall_seconds
         * @returns {string}
         */
        progressLine(wall_seconds) {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.hydrarun_progressLine(this.__wbg_ptr, wall_seconds);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * The engine's JSON summary, or `undefined` for an engine that does
         * not offer one (which is what the CLI refuses a `.json` path for).
         * @returns {string | undefined}
         */
        reportJson() {
            const ret = wasm.hydrarun_reportJson(this.__wbg_ptr);
            if (ret[3]) {
                throw takeFromExternrefTable0(ret[2]);
            }
            let v1;
            if (ret[0] !== 0) {
                v1 = getStringFromWasm0(ret[0], ret[1]).slice();
                wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            }
            return v1;
        }
        /**
         * The engine's text summary — what `hydra run` prints to stdout.
         * @returns {string}
         */
        reportText() {
            let deferred2_0;
            let deferred2_1;
            try {
                const ret = wasm.hydrarun_reportText(this.__wbg_ptr);
                var ptr1 = ret[0];
                var len1 = ret[1];
                if (ret[3]) {
                    ptr1 = 0; len1 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * The binary `.out` results, when they were captured. `undefined`
         * otherwise.
         * @returns {Uint8Array | undefined}
         */
        resultsBytes() {
            const ret = wasm.hydrarun_resultsBytes(this.__wbg_ptr);
            let v1;
            if (ret[0] !== 0) {
                v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
                wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            }
            return v1;
        }
        /**
         * Diagnostics produced since the last call, as a JSON array. Each
         * element is one line the CLI would have written to stderr.
         * @returns {string}
         */
        takeDiagnostics() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.hydrarun_takeDiagnostics(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
    }
    if (Symbol.dispose) HydraRun.prototype[Symbol.dispose] = HydraRun.prototype.free;
    exports.HydraRun = HydraRun;

    /**
     * What to open, built up call by call.
     *
     * A builder rather than a wide `open(…)` because the auxiliary files are a
     * *list* of name-and-bytes pairs, and the alternatives for passing one
     * across this boundary are all worse: parallel arrays that can fall out of
     * step, or an array of typed arrays, which costs a `js-sys` dependency to
     * unpack. Adding them one at a time costs neither.
     */
    class RunOptions {
        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            RunOptionsFinalization.unregister(this);
            return ptr;
        }
        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_runoptions_free(ptr, 0);
        }
        /**
         * The model's bytes and the name it arrived with.
         * @param {Uint8Array} model
         * @param {string} model_name
         */
        constructor(model, model_name) {
            const ptr0 = passArray8ToWasm0(model, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(model_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.runoptions_new(ptr0, len0, ptr1, len1);
            this.__wbg_ptr = ret >>> 0;
            RunOptionsFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * Supply a file the model may declare by name (uds climate, hotstart
         * and routing-inflow files).
         * @param {string} name
         * @param {Uint8Array} bytes
         */
        withAuxFile(name, bytes) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            wasm.runoptions_withAuxFile(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        }
        /**
         * Name the engine explicitly. Left unset, the model is asked — and
         * there is no default (common spec §2.5.1).
         * @param {string | null} [key]
         */
        withEngine(key) {
            var ptr0 = isLikeNone(key) ? 0 : passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            wasm.runoptions_withEngine(this.__wbg_ptr, ptr0, len0);
        }
        /**
         * Capture the binary `.out` results in memory — the CLI's
         * `--results`. Off by default: the whole file has to be held.
         * @param {boolean} on
         */
        withResults(on) {
            wasm.runoptions_withResults(this.__wbg_ptr, on);
        }
    }
    if (Symbol.dispose) RunOptions.prototype[Symbol.dispose] = RunOptions.prototype.free;
    exports.RunOptions = RunOptions;

    /**
     * Every engine this build provides, as `hydra engines` lists them.
     *
     * Includes the planned ones, with `available: false`, because a page that
     * hid them would misrepresent the registry — a planned engine is a
     * reserved key, not an absent one.
     * @returns {string}
     */
    function engines() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engines();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    exports.engines = engines;

    /**
     * One bundled example's model text, by id. `undefined` for an unknown id.
     * @param {string} id
     * @returns {string | undefined}
     */
    function exampleModel(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.exampleModel(ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    exports.exampleModel = exampleModel;

    /**
     * The bundled example models, as JSON, without their text.
     *
     * For a picker: most visitors have no `.inp` file to hand, and a drop
     * target with nothing to drop on it demonstrates nothing.
     * @returns {string}
     */
    function examples() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.examples();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    exports.examples = examples;

    /**
     * Make a panic say what happened.
     *
     * A Rust panic compiled to wasm becomes an `unreachable` instruction, and
     * the only thing that reaches JavaScript is the word "unreachable" — no
     * message, no location, nothing to act on. The engines are `Result`-based
     * throughout and should not panic, which is exactly why a panic that does
     * escape needs to be legible: it is a bug report, and one that arrives as
     * "unreachable" cannot be filed.
     *
     * Runs automatically when the module initialises.
     */
    function install_panic_hook() {
        wasm.install_panic_hook();
    }
    exports.install_panic_hook = install_panic_hook;

    /**
     * Hydra's version, and each subsystem's — the same values `hydra --version`
     * prints.
     * @returns {string}
     */
    function versionInfo() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.versionInfo();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    exports.versionInfo = versionInfo;
    function __wbg_get_imports() {
        const import0 = {
            __proto__: null,
            __wbg_Error_960c155d3d49e4c2: function(arg0, arg1) {
                const ret = Error(getStringFromWasm0(arg0, arg1));
                return ret;
            },
            __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
                throw new Error(getStringFromWasm0(arg0, arg1));
            },
            __wbg_error_75d406d495ee0841: function(arg0, arg1) {
                console.error(getStringFromWasm0(arg0, arg1));
            },
            __wbg_getTime_da7c55f52b71e8c6: function(arg0) {
                const ret = arg0.getTime();
                return ret;
            },
            __wbg_getTimezoneOffset_31f57a5389d0d57c: function(arg0) {
                const ret = arg0.getTimezoneOffset();
                return ret;
            },
            __wbg_new_0_4d657201ced14de3: function() {
                const ret = new Date();
                return ret;
            },
            __wbg_new_7913666fe5070684: function(arg0) {
                const ret = new Date(arg0);
                return ret;
            },
            __wbindgen_cast_0000000000000001: function(arg0) {
                // Cast intrinsic for `F64 -> Externref`.
                const ret = arg0;
                return ret;
            },
            __wbindgen_init_externref_table: function() {
                const table = wasm.__wbindgen_externrefs;
                const offset = table.grow(4);
                table.set(0, undefined);
                table.set(offset + 0, undefined);
                table.set(offset + 1, null);
                table.set(offset + 2, true);
                table.set(offset + 3, false);
            },
        };
        return {
            __proto__: null,
            "./hydra_bg.js": import0,
        };
    }

    const HydraRunFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_hydrarun_free(ptr >>> 0, 1));
    const RunOptionsFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_runoptions_free(ptr >>> 0, 1));

    function _assertClass(instance, klass) {
        if (!(instance instanceof klass)) {
            throw new Error(`expected instance of ${klass.name}`);
        }
    }

    function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
    }

    function getStringFromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return decodeText(ptr, len);
    }

    let cachedUint8ArrayMemory0 = null;
    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    function isLikeNone(x) {
        return x === undefined || x === null;
    }

    function passArray8ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 1, 1) >>> 0;
        getUint8ArrayMemory0().set(arg, ptr / 1);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    function passStringToWasm0(arg, malloc, realloc) {
        if (realloc === undefined) {
            const buf = cachedTextEncoder.encode(arg);
            const ptr = malloc(buf.length, 1) >>> 0;
            getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
            WASM_VECTOR_LEN = buf.length;
            return ptr;
        }

        let len = arg.length;
        let ptr = malloc(len, 1) >>> 0;

        const mem = getUint8ArrayMemory0();

        let offset = 0;

        for (; offset < len; offset++) {
            const code = arg.charCodeAt(offset);
            if (code > 0x7F) break;
            mem[ptr + offset] = code;
        }
        if (offset !== len) {
            if (offset !== 0) {
                arg = arg.slice(offset);
            }
            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
            const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
            const ret = cachedTextEncoder.encodeInto(arg, view);

            offset += ret.written;
            ptr = realloc(ptr, len, offset, 1) >>> 0;
        }

        WASM_VECTOR_LEN = offset;
        return ptr;
    }

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_externrefs.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    function decodeText(ptr, len) {
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
    }

    const cachedTextEncoder = new TextEncoder();

    if (!('encodeInto' in cachedTextEncoder)) {
        cachedTextEncoder.encodeInto = function (arg, view) {
            const buf = cachedTextEncoder.encode(arg);
            view.set(buf);
            return {
                read: arg.length,
                written: buf.length
            };
        };
    }

    let WASM_VECTOR_LEN = 0;

    let wasmModule, wasm;
    function __wbg_finalize_init(instance, module) {
        wasm = instance.exports;
        wasmModule = module;
        cachedUint8ArrayMemory0 = null;
        wasm.__wbindgen_start();
        return wasm;
    }

    async function __wbg_load(module, imports) {
        if (typeof Response === 'function' && module instanceof Response) {
            if (typeof WebAssembly.instantiateStreaming === 'function') {
                try {
                    return await WebAssembly.instantiateStreaming(module, imports);
                } catch (e) {
                    const validResponse = module.ok && expectedResponseType(module.type);

                    if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                        console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                    } else { throw e; }
                }
            }

            const bytes = await module.arrayBuffer();
            return await WebAssembly.instantiate(bytes, imports);
        } else {
            const instance = await WebAssembly.instantiate(module, imports);

            if (instance instanceof WebAssembly.Instance) {
                return { instance, module };
            } else {
                return instance;
            }
        }

        function expectedResponseType(type) {
            switch (type) {
                case 'basic': case 'cors': case 'default': return true;
            }
            return false;
        }
    }

    function initSync(module) {
        if (wasm !== undefined) return wasm;


        if (module !== undefined) {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module} = module)
            } else {
                console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports();
        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }
        const instance = new WebAssembly.Instance(module, imports);
        return __wbg_finalize_init(instance, module);
    }

    async function __wbg_init(module_or_path) {
        if (wasm !== undefined) return wasm;


        if (module_or_path !== undefined) {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                ({module_or_path} = module_or_path)
            } else {
                console.warn('using deprecated parameters for the initialization function; pass a single object instead')
            }
        }

        if (module_or_path === undefined && script_src !== undefined) {
            module_or_path = script_src.replace(/\.js$/, "_bg.wasm");
        }
        const imports = __wbg_get_imports();

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module);
    }

    return Object.assign(__wbg_init, { initSync }, exports);
})({ __proto__: null });
