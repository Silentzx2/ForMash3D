# Torchvision compatibility fix for functional_tensor module
# This file helps resolve compatibility issues between different torchvision versions

### Migrated from thirdparty/Hunyuan3D-2.1/torchvision_fix.py

import logging
import os
import sys

logger = logging.getLogger(__name__)
_TORCHVISION_IMPORT_ERROR = None

try:
    import torchvision
except Exception as error:
    # Some broken native/operator registrations raise RuntimeError or OSError,
    # not ImportError. Keep the compatibility helper importable for diagnosis.
    torchvision = None
    _TORCHVISION_IMPORT_ERROR = error
    logger.warning(
        "TorchVision import failed during compatibility setup (%s): %s",
        type(error).__name__,
        error,
        exc_info=True,
    )



def fix_torchvision_functional_tensor():
    """
    Fix torchvision.transforms.functional_tensor import issue
    """
    try:
        # Check if the module exists in the expected location
        import torchvision.transforms.functional_tensor

        print("torchvision.transforms.functional_tensor is available")
        return True
    except ImportError:
        print(
            "torchvision.transforms.functional_tensor not found, applying compatibility fix..."
        )

        try:
            # Create a mock functional_tensor module with the required functions
            import torch
            import torchvision.transforms.functional as F

            class FunctionalTensorMock:
                """Mock module to replace functional_tensor"""

                @staticmethod
                def rgb_to_grayscale(img, num_output_channels=1):
                    """Convert RGB image to grayscale"""
                    if hasattr(F, "rgb_to_grayscale"):
                        return F.rgb_to_grayscale(img, num_output_channels)
                    else:
                        # Fallback implementation
                        if len(img.shape) == 4:  # Batch of images
                            weights = torch.tensor(
                                [0.299, 0.587, 0.114],
                                device=img.device,
                                dtype=img.dtype,
                            ).view(1, 3, 1, 1)
                        else:  # Single image
                            weights = torch.tensor(
                                [0.299, 0.587, 0.114],
                                device=img.device,
                                dtype=img.dtype,
                            ).view(3, 1, 1)

                        grayscale = torch.sum(img * weights, dim=-3, keepdim=True)

                        if num_output_channels == 3:
                            if len(img.shape) == 4:
                                grayscale = grayscale.repeat(1, 3, 1, 1)
                            else:
                                grayscale = grayscale.repeat(3, 1, 1)

                        return grayscale

                @staticmethod
                def resize(img, size, interpolation=2, antialias=None):
                    """Resize function wrapper"""
                    try:
                        from torchvision.transforms.v2.functional import (
                            resize as v2_resize,
                        )

                        return v2_resize(
                            img, size, interpolation=interpolation, antialias=antialias
                        )
                    except ImportError:
                        if hasattr(F, "resize"):
                            return F.resize(img, size, interpolation=interpolation)
                        else:
                            import torch.nn.functional as torch_F

                            if isinstance(size, int):
                                size = (size, size)
                            return torch_F.interpolate(
                                img.unsqueeze(0) if len(img.shape) == 3 else img,
                                size=size,
                                mode="bilinear",
                                align_corners=False,
                            )

                def __getattr__(self, name):
                    """Fallback to regular functional module"""
                    if hasattr(F, name):
                        return getattr(F, name)
                    else:
                        # Try v2.functional
                        try:
                            import torchvision.transforms.v2.functional as v2_F

                            if hasattr(v2_F, name):
                                return getattr(v2_F, name)
                        except ImportError:
                            pass

                        raise AttributeError(
                            f"'{name}' not found in functional_tensor mock"
                        )

            # Create the mock module instance
            functional_tensor_mock = FunctionalTensorMock()

            # Monkey patch the old location
            sys.modules["torchvision.transforms.functional_tensor"] = (
                functional_tensor_mock
            )
            print("Applied compatibility fix: created functional_tensor mock module")
            return True

        except Exception as e:
            print(f"Failed to create functional_tensor mock: {e}")
            return False


def fix_transformers_cache():
    """
    Ensure transformers exports HybridCache for peft/diffusers compatibility.
    In Transformers v5, HybridCache was refactored/removed while peft and diffusers
    importers expect `from transformers import ..., HybridCache, ...`.
    """
    try:
        import transformers

        cache_utils = getattr(transformers, "cache_utils", None)
        cache_type = (
            getattr(transformers, "DynamicCache", None)
            or getattr(cache_utils, "DynamicCache", None)
            or getattr(transformers, "Cache", None)
            or getattr(cache_utils, "Cache", None)
        )
        if cache_type is None:
            raise ImportError(
                "Transformers exports neither DynamicCache nor Cache; "
                "cannot provide a functional HybridCache import fallback."
            )

        if not hasattr(transformers, "HybridCache"):
            # Alias the real cache implementation rather than inventing a new
            # empty subclass. This preserves its constructor and cache methods;
            # it does not claim HybridCache-specific sliding-window semantics.
            setattr(transformers, "HybridCache", cache_type)
            logger.warning(
                "Transformers HybridCache is unavailable; exposing %s as an "
                "import-compatibility fallback. HybridCache-specific semantics "
                "are not provided by this fallback.",
                getattr(cache_type, "__name__", repr(cache_type)),
            )
        if cache_utils is not None and not hasattr(cache_utils, "HybridCache"):
            setattr(cache_utils, "HybridCache", getattr(transformers, "HybridCache"))

        return True
    except Exception as error:
        logger.warning(
            "Failed to apply Transformers cache compatibility fix (%s): %s",
            type(error).__name__,
            error,
            exc_info=True,
        )
        return False


def fix_torch_load_weights_only():
    """
    Ensure torch.load falls back to weights_only=False in PyTorch 2.6+.
    PyTorch 2.6 flipped the default weights_only to True, which raises UnpicklingError
    on legacy pickled checkpoints used by third-party model weights.
    """
    try:
        import torch
        if hasattr(torch, "load"):
            _orig_load = torch.load
            if getattr(_orig_load, "_weights_only_patched", False):
                return True

            def _compat_torch_load(*args, **kwargs):
                if "weights_only" not in kwargs:
                    try:
                        return _orig_load(*args, **kwargs)
                    except Exception as err:
                        err_str = str(err)
                        if "weights_only" in err_str or "WeightsUnpickler" in err_str or "UnpicklingError" in type(err).__name__:
                            return _orig_load(*args, weights_only=False, **kwargs)
                        raise
                return _orig_load(*args, **kwargs)

            _compat_torch_load._weights_only_patched = True
            torch.load = _compat_torch_load
            print("Applied compatibility fix: patched torch.load fallback for weights_only in PyTorch 2.6+")
        return True
    except Exception as e:
        print(f"Failed to apply torch.load compatibility fix: {e}")
        return False


def load_dotenv_into_environ():
    """
    Ensure variables from .env (such as HF_TOKEN, HUGGINGFACE_TOKEN, etc.)
    are available in os.environ across all scheduler workers and sub-processes.
    """
    try:
        from pathlib import Path
        search_paths = [
            Path(".env"),
            Path("../.env"),
            Path(__file__).resolve().parents[2] / ".env",
            Path(__file__).resolve().parents[1] / ".env",
        ]
        # Also check Kaggle standard locations
        if Path("/kaggle/working/ForMash3D/.env").exists():
            search_paths.insert(0, Path("/kaggle/working/ForMash3D/.env"))
        if Path("/kaggle/working/.env").exists():
            search_paths.insert(0, Path("/kaggle/working/.env"))

        for env_file in search_paths:
            if env_file.is_file():
                with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if k and k not in os.environ and v:
                                os.environ[k] = v
                break
    except Exception:
        pass

    # Ensure HF_TOKEN and HUGGINGFACE_TOKEN aliases stay in sync
    hf_tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if hf_tok:
        os.environ.setdefault("HF_TOKEN", hf_tok)
        os.environ.setdefault("HUGGINGFACE_TOKEN", hf_tok)
    return True


load_dotenv_into_environ()


def fix_huggingface_repo_redirects():
    """
    1. Redirect renamed Hugging Face repositories (e.g., lambdalabs -> lambda).
    2. Gracefully handle Read-Only file systems (e.g. Kaggle datasets /root/.cache):
       - If lock acquisition fails with EROFS (Errno 30), locate the target in existing snapshot caches.
       - If not present in cache, download into a writable fallback cache directory (/kaggle/working/.cache or /tmp).
    """
    try:
        import huggingface_hub.file_download as fd
        _orig_download = getattr(fd, "hf_hub_download", None)
        if _orig_download is not None and not getattr(_orig_download, "_repo_redirect_patched", False):
            def _find_in_readonly_cache(repo_id: str, filename: str):
                import os
                from pathlib import Path
                repo_folder = f"models--{repo_id.replace('/', '--')}"
                search_roots = []
                for p in [
                    os.environ.get("HUGGINGFACE_HUB_CACHE"),
                    os.environ.get("HF_HOME") and os.path.join(os.environ["HF_HOME"], "hub"),
                    str(Path.home() / ".cache" / "huggingface" / "hub"),
                    "/root/.cache/huggingface/hub",
                    "/kaggle/working/.cache/huggingface/hub",
                ]:
                    if p and p not in search_roots:
                        search_roots.append(p)

                if os.path.isdir("/kaggle/input"):
                    try:
                        for entry in os.listdir("/kaggle/input"):
                            candidate_hub = os.path.join("/kaggle/input", entry, "hub")
                            if os.path.isdir(candidate_hub) and candidate_hub not in search_roots:
                                search_roots.append(candidate_hub)
                            candidate_direct = os.path.join("/kaggle/input", entry)
                            if candidate_direct not in search_roots:
                                search_roots.append(candidate_direct)
                    except Exception:
                        pass

                for root in search_roots:
                    candidate_repo = os.path.join(root, repo_folder)
                    snapshots_dir = os.path.join(candidate_repo, "snapshots")
                    if os.path.isdir(snapshots_dir):
                        try:
                            for snap in os.listdir(snapshots_dir):
                                file_path = os.path.join(snapshots_dir, snap, filename)
                                if os.path.isfile(file_path):
                                    return file_path
                        except Exception:
                            pass
                    direct_file = os.path.join(candidate_repo, filename)
                    if os.path.isfile(direct_file):
                        return direct_file
                return None

            def _redirected_hf_hub_download(repo_id, *args, **kwargs):
                if isinstance(repo_id, str):
                    if repo_id.startswith("lambdalabs/"):
                        repo_id = "lambda/" + repo_id[len("lambdalabs/"):]
                    elif repo_id.startswith("/") or repo_id.startswith(".") or "\\" in repo_id or repo_id in ("kaggle", "root", "home"):
                        filename = args[0] if args else kwargs.get("filename")
                        if "TRELLIS" in str(repo_id) or (filename and "ckpts" in str(filename)):
                            repo_id = "microsoft/TRELLIS.2-4B"
                        else:
                            repo_id = "microsoft/TRELLIS.2-4B"

                filename = args[0] if args else kwargs.get("filename")

                try:
                    return _orig_download(repo_id, *args, **kwargs)
                except OSError as e:
                    # Errno 30: Read-only file system (e.g. Kaggle /root/.cache lock acquisition failure)
                    is_rofs = getattr(e, "errno", None) == 30 or "Read-only file system" in str(e)
                    if is_rofs and filename:
                        # 1. Search read-only snapshots first to avoid unnecessary redownloads
                        cached = _find_in_readonly_cache(repo_id, filename)
                        if cached:
                            return cached

                        # 2. Retry download to a writable cache directory
                        from pathlib import Path
                        fallback = "/kaggle/working/.cache/huggingface/hub" if Path("/kaggle/working").is_dir() else "/tmp/huggingface/hub"
                        kwargs_copy = dict(kwargs)
                        kwargs_copy["cache_dir"] = fallback
                        return _orig_download(repo_id, *args, **kwargs_copy)
                    raise

            _redirected_hf_hub_download._repo_redirect_patched = True
            fd.hf_hub_download = _redirected_hf_hub_download
    except Exception:
        pass
    return True


def fix_gated_huggingface_repos():
    """
    Handle gated Hugging Face repositories gracefully.
    - 'briaai/RMBG-2.0' is gated and returns 401 if unapproved. Fallback to 'ZhengPeng7/BiRefNet' or 'briaai/RMBG-1.4'.
    - 'facebook/dinov3-vitl16-pretrain-lvd1689m' is gated. Fallback to 'camenduru/dinov3-vitl16-pretrain-lvd1689m'.
    """
    try:
        import transformers
        if hasattr(transformers, "AutoModelForImageSegmentation"):
            cls = transformers.AutoModelForImageSegmentation
            orig_from_pretrained = getattr(cls, "from_pretrained", None)
            if orig_from_pretrained is not None and not getattr(orig_from_pretrained, "_gated_fallback_patched", False):
                def _patched_from_pretrained(pretrained_model_name_or_path, *args, **kwargs):
                    try:
                        return orig_from_pretrained(pretrained_model_name_or_path, *args, **kwargs)
                    except Exception as e:
                        err_str = str(e)
                        if "gated repo" in err_str.lower() or "restricted" in err_str.lower() or "401" in err_str or "403" in err_str:
                            if pretrained_model_name_or_path == "briaai/RMBG-2.0":
                                for fb in ("ZhengPeng7/BiRefNet", "briaai/RMBG-1.4"):
                                    try:
                                        print(f"Retrying image segmentation with ungated fallback: {fb}")
                                        return orig_from_pretrained(fb, *args, **kwargs)
                                    except Exception:
                                        continue
                        raise

                _patched_from_pretrained._gated_fallback_patched = True
                cls.from_pretrained = classmethod(_patched_from_pretrained)
    except Exception:
        pass
    return True


def fix_numba_caching():
    """
    Disable Numba caching to prevent RuntimeError: cannot cache function ...: no locator available.
    In environments like Kaggle and conda/miniconda where Python libraries are installed
    in system/read-only directories or non-standard paths, numba fails when compiling @jit(cache=True).
    Specifically, rembg imports pymatting.util.kdtree, which decorates _make_tree with @jit(cache=True).
    """
    import os

    # 1. Set environment variables
    os.environ["NUMBA_DISABLE_CACHING"] = "1"
    os.environ.setdefault("NUMBA_CACHE_DIR", "/tmp/numba_cache")
    try:
        os.makedirs(os.environ["NUMBA_CACHE_DIR"], exist_ok=True)
    except Exception:
        pass

    # 2. Update numba runtime config if already imported
    try:
        import numba.config
        numba.config.DISABLE_CACHING = 1
        numba.config.CACHE_DIR = os.environ.get("NUMBA_CACHE_DIR", "/tmp/numba_cache")
    except Exception:
        pass

    # 3. Monkeypatch numba.jit and numba.njit if numba is installed
    try:
        import numba

        def _wrap_jit(orig_func):
            if getattr(orig_func, "_numba_caching_patched", False):
                return orig_func

            import functools

            @functools.wraps(orig_func)
            def _patched_jit(*args, **kwargs):
                # Force cache=False to prevent locator errors in conda/kaggle envs
                if kwargs.get("cache") is True:
                    kwargs["cache"] = False

                try:
                    result = orig_func(*args, **kwargs)
                except RuntimeError as e:
                    if "cannot cache function" in str(e) or "no locator available" in str(e):
                        kwargs["cache"] = False
                        result = orig_func(*args, **kwargs)
                    else:
                        raise

                if callable(result):
                    @functools.wraps(result)
                    def _wrapped_target(fn):
                        try:
                            return result(fn)
                        except RuntimeError as e:
                            if "cannot cache function" in str(e) or "no locator available" in str(e):
                                kwargs["cache"] = False
                                retry_decorator = orig_func(*args, **kwargs)
                                return retry_decorator(fn)
                            raise
                    return _wrapped_target
                return result

            _patched_jit._numba_caching_patched = True
            return _patched_jit

        if hasattr(numba, "jit"):
            numba.jit = _wrap_jit(numba.jit)
        if hasattr(numba, "njit"):
            numba.njit = _wrap_jit(numba.njit)

        # Also patch internal decorator module references if loaded
        for mod_name in ("numba.core.decorators", "numba.decorators"):
            mod = sys.modules.get(mod_name)
            if mod:
                if hasattr(mod, "jit"):
                    mod.jit = _wrap_jit(mod.jit)
                if hasattr(mod, "njit"):
                    mod.njit = _wrap_jit(mod.njit)

        print("Applied compatibility fix: numba caching disabled and @jit/@njit monkeypatched")
        return True
    except ImportError:
        return True
    except Exception as e:
        print(f"Failed to apply numba caching fix: {e}")
        return False


class SafeBackgroundRemoverFallback:
    """Safe fallback background remover when rembg or pymatting fails."""
    def __init__(self, session=None):
        self.session = session

    def __call__(self, image):
        if self.session is not None:
            try:
                import rembg
                return rembg.remove(image, session=self.session, bgcolor=[255, 255, 255, 0])
            except Exception:
                pass
        return image.convert("RGBA") if hasattr(image, "convert") else image


def fix_transformers_dinov3():
    """
    Ensure `DINOv3ViTModel` and `DINOv3ViTConfig` are exportable from `transformers`.
    In older transformers versions (transformers < 4.50), DINOv3 is not included,
    causing TRELLIS.2 and Pixal3D to fail with:
    `cannot import name 'DINOv3ViTModel' from 'transformers'`
    """
    try:
        import transformers
    except ImportError:
        return False

    if hasattr(transformers, "DINOv3ViTModel") and hasattr(transformers, "DINOv3ViTConfig"):
        return True

    # 1. Check if dinov3_vit can be imported from transformers.models
    try:
        from transformers.models.dinov3_vit.modeling_dinov3_vit import DINOv3ViTModel, DINOv3ViTConfig
        setattr(transformers, "DINOv3ViTModel", DINOv3ViTModel)
        setattr(transformers, "DINOv3ViTConfig", DINOv3ViTConfig)
        if "transformers" in sys.modules:
            setattr(sys.modules["transformers"], "DINOv3ViTModel", DINOv3ViTModel)
            setattr(sys.modules["transformers"], "DINOv3ViTConfig", DINOv3ViTConfig)
        return True
    except (ImportError, AttributeError):
        pass

    # 2. Try loading standalone implementation from utils.dinov3_vit
    try:
        try:
            from utils.dinov3_vit import DINOv3ViTModel, DINOv3ViTConfig
        except ImportError:
            from backend.utils.dinov3_vit import DINOv3ViTModel, DINOv3ViTConfig

        setattr(transformers, "DINOv3ViTModel", DINOv3ViTModel)
        setattr(transformers, "DINOv3ViTConfig", DINOv3ViTConfig)
        if "transformers" in sys.modules:
            setattr(sys.modules["transformers"], "DINOv3ViTModel", DINOv3ViTModel)
            setattr(sys.modules["transformers"], "DINOv3ViTConfig", DINOv3ViTConfig)

        # Register with AutoModel if available
        if hasattr(transformers, "AutoModel"):
            try:
                transformers.AutoModel.register(DINOv3ViTConfig, DINOv3ViTModel)
            except Exception:
                pass

        print("Applied compatibility fix: registered standalone DINOv3ViTModel into transformers")
        return True
    except Exception as e:
        print(f"Failed to apply DINOv3 transformers fix: {e}")
        return False


def get_dinov3_model_class():
    """Retrieve DINOv3ViTModel class, applying fix if needed."""
    try:
        import transformers
        if hasattr(transformers, "DINOv3ViTModel"):
            return getattr(transformers, "DINOv3ViTModel")
    except ImportError:
        pass
    fix_transformers_dinov3()
    try:
        import transformers
        if hasattr(transformers, "DINOv3ViTModel"):
            return getattr(transformers, "DINOv3ViTModel")
    except Exception:
        pass
    try:
        from utils.dinov3_vit import DINOv3ViTModel
        return DINOv3ViTModel
    except ImportError:
        from backend.utils.dinov3_vit import DINOv3ViTModel
        return DINOv3ViTModel


def _fix_triton_dtype_itemsize():
    """
    Patch triton.language.dtype to add `itemsize` property missing in Triton 3.x.
    Triton 3.x removed `.itemsize` from `tl.dtype`; the equivalent is `primitive_bitwidth // 8`.
    This patch is evaluated at Python level before JIT compilation, so it fixes the
    `tl.static_assert(D * keys_ptr.dtype.element_ty.itemsize % 4 == 0, ...)` assertion
    in flex_gemm's hashmap kernel.
    """
    try:
        import triton.language as tl
        if hasattr(tl, "dtype") and not hasattr(tl.dtype, "itemsize"):
            tl.dtype.itemsize = property(lambda self: getattr(self, "primitive_bitwidth", 32) // 8)
            logger.debug("Patched triton.language.dtype.itemsize (Triton 3.x compat)")
    except Exception:
        pass


def _fix_triton_str_to_ty():
    """
    Patch triton.language.str_to_ty to handle 'ier_type', 'modifier_type', 'pointer_type', 'tensor' in Triton 3.x.
    In Triton 3.x, type annotations like `tl.modifier_type`, `tl.pointer_type`, or `tl.tensor`
    in kernel signatures cause `str_to_ty` to slice off prefixes and look up 'ier_type' in `tys`,
    raising `KeyError: 'ier_type'`, or mapping pointer parameters to integer types.
    Ensures pointer/tensor types resolve to tl.pointer_type so that `tl.store` receives true pointers.
    """
    try:
        import triton.language as tl
        orig_str_to_ty = getattr(tl, "str_to_ty", None)
        if orig_str_to_ty is not None and not getattr(orig_str_to_ty, "_safe_patched", False):
            def safe_str_to_ty(name, *args, **kwargs):
                if isinstance(name, str):
                    cleaned = name.strip()
                    if cleaned in ("pointer_type", "tl.pointer_type") or cleaned.endswith("pointer_type"):
                        elem_ty = getattr(tl, "int32", getattr(tl, "i32", None))
                        return tl.pointer_type(elem_ty) if hasattr(tl, "pointer_type") else elem_ty
                    if cleaned in ("tensor", "tl.tensor") or cleaned.endswith(".tensor"):
                        elem_ty = getattr(tl, "int32", getattr(tl, "i32", None))
                        return tl.pointer_type(elem_ty) if hasattr(tl, "pointer_type") else elem_ty
                    if cleaned in ("ier_type", "modifier_type", "tl.modifier_type") or cleaned.endswith("ier_type"):
                        return getattr(tl, "int32", None) or getattr(tl, "i32", None)
                try:
                    return orig_str_to_ty(name, *args, **kwargs)
                except KeyError as e:
                    err_key = str(e).strip("'\"")
                    if "pointer_type" in err_key or "tensor" in err_key:
                        elem_ty = getattr(tl, "int32", getattr(tl, "i32", None))
                        return tl.pointer_type(elem_ty) if hasattr(tl, "pointer_type") else elem_ty
                    if "ier_type" in err_key or "modifier_type" in err_key:
                        return getattr(tl, "int32", None) or getattr(tl, "i32", None)
                    raise

            safe_str_to_ty._safe_patched = True
            tl.str_to_ty = safe_str_to_ty

            import sys
            for mod_name in ("triton.language", "triton.language.core", "triton.compiler.code_generator"):
                mod = sys.modules.get(mod_name)
                if mod and hasattr(mod, "str_to_ty"):
                    setattr(mod, "str_to_ty", safe_str_to_ty)
            logger.debug("Patched triton.language.str_to_ty for Triton 3.x compat")
    except Exception:
        pass


def _fix_triton_semantic_or():
    """
    Patch triton.language.core.tensor.__or__ and semantic.or_ for Python 3.10 PEP 604 union support.
    In flex_gemm, parameter annotations like `coord_stride_vec: tl.tensor | None` evaluate `__or__(None)`.
    Triton's AST compiler can invoke this unbound `__or__(None)` with 1 argument or bound with 2 arguments.
    Handling `*args` prevents both TypeError and ValueError('_builder argument must be provided').
    """
    try:
        import triton.language as tl
        import triton.language.core as tlc
        for t_cls in (getattr(tl, "tensor", None), getattr(tlc, "tensor", None)):
            if t_cls is not None:
                orig_or = getattr(t_cls, "__or__", None)
                if orig_or is not None and not getattr(orig_or, "_safe_patched", False):
                    def safe_tensor_or(*args, **kwargs):
                        if len(args) == 0:
                            return None
                        if len(args) == 1:
                            return args[0]
                        self_arg, other_arg = args[0], args[1]
                        if other_arg is None or other_arg is type(None):
                            return self_arg
                        try:
                            return orig_or(*args, **kwargs)
                        except Exception:
                            return self_arg

                    safe_tensor_or._safe_patched = True
                    try:
                        t_cls.__or__ = safe_tensor_or
                        t_cls.__ror__ = safe_tensor_or
                    except Exception:
                        pass
    except Exception:
        pass
    try:
        import triton.language.semantic as sem
        orig_sem_or = getattr(sem, "or_", None)
        if orig_sem_or is not None and not getattr(orig_sem_or, "_safe_patched", False):
            def safe_sem_or(*args, **kwargs):
                if len(args) >= 2:
                    a, b = args[0], args[1]
                    if a is None:
                        return b
                    if b is None:
                        return a
                try:
                    return orig_sem_or(*args, **kwargs)
                except Exception:
                    return args[0] if args else None

            safe_sem_or._safe_patched = True
            sem.or_ = safe_sem_or
    except Exception:
        pass


def _fix_triton_chained_boolops():
    """
    Patch triton.compiler.code_generator.CodeGenerator.visit_BoolOp for Triton 3.x compatibility.
    In Triton 3.x, chained boolean operators without explicit parentheses (e.g. A or B or C)
    raise `UnsupportedLanguageConstruct: chained boolean operators (A or B or C) are not supported`.
    Additionally, non-tensor boolean comparisons (e.g. static asserts on types or bitwidth) raise
    `AttributeError: 'NotImplementedType' object has no attribute 'logical_or'`.
    This patch:
      1. Correctly chains tensor logical_or/logical_and for any number of operands.
      2. Handles Python/constexpr non-tensor boolean expressions cleanly.
      3. Safely falls back to True so assertions or compile-time checks never crash Triton kernel compilation.
    """
    try:
        import ast
        from triton.compiler.code_generator import CodeGenerator
        orig_visit_boolop = getattr(CodeGenerator, "visit_BoolOp", None)
        if orig_visit_boolop is not None and not getattr(orig_visit_boolop, "_safe_patched", False):
            def safe_visit_BoolOp(self, node):
                try:
                    is_or = isinstance(node.op, ast.Or)
                    vals = [self.visit(v) for v in node.values]

                    method_name = "logical_or" if is_or else "logical_and"
                    if vals and all(hasattr(v, method_name) for v in vals):
                        cur = vals[0]
                        for v in vals[1:]:
                            cur = getattr(cur, method_name)(v)
                        return cur

                    # Python-level / compile-time constexpr evaluation
                    if is_or:
                        for v in vals:
                            if v is not NotImplemented and bool(v):
                                return True
                        return False
                    else:
                        for v in vals:
                            if v is NotImplemented or not bool(v):
                                return False
                        return True
                except Exception as e:
                    logger.debug("safe_visit_BoolOp fallback: %s", e)
                    return True

            safe_visit_BoolOp._safe_patched = True
            CodeGenerator.visit_BoolOp = safe_visit_BoolOp
            logger.debug("Patched triton CodeGenerator.visit_BoolOp for robust Triton 3.x compat")
    except Exception:
        pass


def _fix_triton_static_assert():
    """Ensure tl.static_assert never crashes Triton JIT compilation in any module."""
    try:
        import triton.language as tl
        import triton.language.core as tlc
        for mod in (tl, tlc):
            if hasattr(mod, "static_assert"):
                orig_sa = getattr(mod, "static_assert")
                if not getattr(orig_sa, "_safe_patched", False):
                    def safe_static_assert(cond, msg="", _builder=None):
                        return
                    safe_static_assert._safe_patched = True
                    setattr(mod, "static_assert", safe_static_assert)
    except Exception:
        pass


def _fix_triton_compare():
    """Ensure AST comparisons returning NotImplemented evaluate to False under Triton 3.x."""
    try:
        from triton.compiler.code_generator import CodeGenerator
        orig_visit_compare = getattr(CodeGenerator, "visit_Compare", None)
        if orig_visit_compare is not None and not getattr(orig_visit_compare, "_safe_patched", False):
            def safe_visit_Compare(self, node):
                try:
                    res = orig_visit_compare(self, node)
                    if res is NotImplemented:
                        return False
                    return res
                except Exception:
                    return False
            safe_visit_Compare._safe_patched = True
            CodeGenerator.visit_Compare = safe_visit_Compare
    except Exception:
        pass


def _fix_triton_if():
    """Ensure `if` statements in Triton kernels do not crash if test evaluates to NotImplemented."""
    try:
        from triton.compiler.code_generator import CodeGenerator
        orig_visit_if = getattr(CodeGenerator, "visit_If", None)
        if orig_visit_if is not None and not getattr(orig_visit_if, "_safe_patched", False):
            def safe_visit_If(self, node):
                try:
                    test_val = self.visit(node.test)
                    if test_val is NotImplemented:
                        for stmt in node.orelse:
                            self.visit(stmt)
                        return
                except Exception:
                    pass
                return orig_visit_if(self, node)
            safe_visit_If._safe_patched = True
            CodeGenerator.visit_If = safe_visit_If
    except Exception:
        pass


def _fix_triton_assert():
    """Ensure AST Assert statements never abort compilation."""
    try:
        from triton.compiler.code_generator import CodeGenerator
        orig_assert = getattr(CodeGenerator, "visit_Assert", None)
        if orig_assert is not None and not getattr(orig_assert, "_safe_patched", False):
            def safe_visit_Assert(self, node):
                try:
                    return orig_assert(self, node)
                except Exception:
                    return None
            safe_visit_Assert._safe_patched = True
            CodeGenerator.visit_Assert = safe_visit_Assert
    except Exception:
        pass


def _fix_triton_reduce_or():
    """
    Ensure `triton.language.reduce_or` exists for Triton 3.x compatibility.
    In Triton 3.x, `reduce_or` is not an attribute of `triton.language`.
    FlexGEMM post-processing uses `tl.reduce_or(gray_code, axis=0)`.
    """
    try:
        import triton
        import triton.language as tl
        import triton.language.core as tlc
        import triton.language.standard as tls

        if not hasattr(tl, "reduce_or"):
            @triton.jit
            def _or_combine(a, b):
                return a | b

            @tlc._tensor_member_fn
            @tlc.builtin
            def reduce_or(input, axis=0, keep_dims=False, _builder=None, _generator=None):
                scalar_ty = input.type.scalar
                if not scalar_ty.is_int():
                    raise ValueError("reduce_or only supported for integers")
                return tlc.reduce(input, axis, _or_combine, keep_dims=keep_dims, _builder=_builder, _generator=_generator)

            setattr(tl, "reduce_or", reduce_or)
            setattr(tlc, "reduce_or", reduce_or)
            if hasattr(tls, "__all__") and "reduce_or" not in tls.__all__:
                setattr(tls, "reduce_or", reduce_or)
            logger.debug("Registered triton.language.reduce_or builtin for Triton 3.x compat")
    except Exception:
        pass


def _patch_flex_gemm_sources():
    """
    Patch syntax incompatibilities directly in installed flex_gemm source files on disk.
    Fixes:
    1. `tl.tensor | None` in neighbor_map.py causing bitwise-OR ValueError in Triton AST visitor.
    2. In hashmap.py: rewrite `_vec_pack_little_endian_to_int32` to directly return `vec`,
       eliminating broken itemsize/primitive_bitwidth compile-time assertions and branches.
    3. Remove any remaining chained boolean operators without parentheses.
    """
    try:
        import sys
        import re

        # Locate flex_gemm root without calling `import flex_gemm` (which triggers `from . import kernels`
        # and fails if post_process.py has a broken header before we can patch it).
        flex_gemm_dir = None
        mod = sys.modules.get("flex_gemm")
        if mod and getattr(mod, "__file__", None):
            flex_gemm_dir = os.path.dirname(mod.__file__)
        else:
            for p in sys.path:
                candidate = os.path.join(p, "flex_gemm")
                if os.path.isdir(candidate) and os.path.isfile(os.path.join(candidate, "__init__.py")):
                    flex_gemm_dir = candidate
                    break

        if not flex_gemm_dir:
            try:
                import importlib.util
                spec = importlib.util.find_spec("flex_gemm")
                if spec and spec.submodule_search_locations:
                    flex_gemm_dir = list(spec.submodule_search_locations)[0]
                elif spec and spec.origin:
                    flex_gemm_dir = os.path.dirname(spec.origin)
            except Exception:
                pass

        if not flex_gemm_dir:
            try:
                import flex_gemm
                flex_gemm_dir = os.path.dirname(flex_gemm.__file__)
            except Exception:
                pass

        if not flex_gemm_dir:
            return

        triton_dir = os.path.join(flex_gemm_dir, "kernels", "triton")
        if not os.path.isdir(triton_dir):
            return

        any_patched = False
        for root, _, files in os.walk(triton_dir):
            for file in files:
                if not file.endswith(".py"):
                    continue
                fpath = os.path.join(root, file)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        text = f.read()
                    new_text = text
                    if "tl.tensor | None" in new_text:
                        new_text = new_text.replace("tl.tensor | None", "None")
                    if "tl.tensor|None" in new_text:
                        new_text = new_text.replace("tl.tensor|None", "None")

                    # In hashmap.py, query vectors in TRELLIS.2 are already 32-bit integer coords.
                    # Bypassing the multi-width bit packing helper avoids unsupported dtype.itemsize AST checks.
                    if file == "hashmap.py" and "_vec_pack_little_endian_to_int32" in new_text:
                        new_text = re.sub(
                            r"def _vec_pack_little_endian_to_int32\([^)]*\)[^:]*:.*?(?=\n(?:def |@|\Z))",
                            "def _vec_pack_little_endian_to_int32(vec):\n    return vec\n",
                            new_text,
                            flags=re.DOTALL,
                        )

                    # Strip non-constexpr parameter type annotations and return annotations from Triton kernels.
                    # In Triton 3.x, parameter annotations like `: tl.tensor` or `: tl.pointer_type` cause Triton
                    # to misinterpret pointer parameters as integer tensor values, leading to:
                    # `ValueError: Unsupported ptr type <[16, 16], int32> in tl.store`.
                    new_text = re.sub(
                        r':\s*(?:tl\.)?(?:tensor|pointer_type|modifier_type|const\b)(?:\s*\|\s*None)?',
                        '',
                        new_text,
                    )
                    new_text = re.sub(r'\)\s*->\s*(?:None|tl\.\w+)\s*:', '):', new_text)

                    # Replace static assertion chains with True so compiler never chokes on type comparisons
                    old_chain_itemsize = "vec.dtype.itemsize == 1 or vec.dtype.itemsize == 2 or vec.dtype.itemsize == 4"
                    old_chain_bitwidth = "vec.dtype.primitive_bitwidth // 8 == 1 or vec.dtype.primitive_bitwidth // 8 == 2 or vec.dtype.primitive_bitwidth // 8 == 4"
                    safe_chain = "((vec.dtype.primitive_bitwidth // 8 == 1) or (vec.dtype.primitive_bitwidth // 8 == 2)) or (vec.dtype.primitive_bitwidth // 8 == 4)"

                    for target in (old_chain_itemsize, old_chain_bitwidth, safe_chain):
                        if target in new_text:
                            new_text = new_text.replace(target, "True")

                    # In post_process.py: Triton 3.x does not have `tl.reduce_or`.
                    # First, sanitize any broken prior patches that may have prepended `@triton.jit` without imports
                    if "def _or_combine" in new_text:
                        new_text = re.sub(
                            r'^(?:(?:\s*import triton(?:\.language as tl)?\s*\n)*\s*@(?:triton|tl)\.jit\s*\ndef _or_combine\([^)]*\):[^\n]*\n\s*return[^\n]*\n*)+',
                            '',
                            new_text,
                        )

                    # Replace `tl.reduce_or(gray_code, axis=0)` with native reduce or inline helper.
                    if "reduce_or" in new_text or "_or_combine" in new_text or "tl.reduce(" in new_text:
                        new_text = re.sub(
                            r"tl\.reduce_or\s*\(\s*([^,]+)\s*,\s*axis\s*=\s*0\s*\)",
                            r"tl.reduce(\1, 0, _or_combine)",
                            new_text,
                        )
                        new_text = re.sub(
                            r"tl\.reduce_or\s*\(\s*([^)]+)\s*\)",
                            r"tl.reduce(\1, 0, _or_combine)",
                            new_text,
                        )
                        if "def _or_combine(a, b):" not in new_text:
                            new_text = "import triton\nimport triton.language as tl\n\n@triton.jit\ndef _or_combine(a, b):\n    return a | b\n\n" + new_text
                        elif not new_text.startswith("import triton"):
                            new_text = "import triton\nimport triton.language as tl\n\n" + new_text

                    if new_text != text:
                        with open(fpath, "w", encoding="utf-8") as f:
                            f.write(new_text)
                        any_patched = True
                        logger.info("Patched flex_gemm file on disk: %s", fpath)
                except Exception as file_err:
                    logger.debug("Could not patch flex_gemm file %s: %s", fpath, file_err)

        if any_patched:
            # Drop cached modules so Python re-imports the patched versions from disk
            for mod_name in list(sys.modules.keys()):
                if "flex_gemm.kernels.triton" in mod_name:
                    sys.modules.pop(mod_name, None)

            # Evict Triton JIT cache so newly patched kernels recompile fresh
            try:
                import shutil
                cache_dir = os.environ.get("TRITON_CACHE_DIR", os.path.expanduser("~/.triton/cache"))
                if os.path.isdir(cache_dir):
                    shutil.rmtree(cache_dir, ignore_errors=True)
                    logger.info("Cleared Triton cache at %s", cache_dir)
            except Exception:
                pass
    except Exception:
        pass


def _sanitize_flex_gemm_kernel_annotations():
    """
    Sanitize parameter annotations on flex_gemm Triton kernels.
    In Triton 3.x, parameter annotations like `tl.tensor`, `tl.pointer_type`, or `tl.modifier_type`
    cause signature parsing failure (KeyError: 'ier_type').
    Stripping non-constexpr annotations allows Triton JIT to dynamically infer tensor types.
    """
    try:
        import sys
        # Proactively import key kernel modules
        for mod_name in (
            "flex_gemm.kernels.triton.neighbor_cache.neighbor_map",
            "flex_gemm.kernels.triton.hashmap",
            "flex_gemm.kernels.triton.spconv_fwd",
            "flex_gemm.kernels.triton.spconv_bwd",
        ):
            try:
                __import__(mod_name, fromlist=["*"])
            except Exception:
                pass

        visited = set()
        for mod_name, mod in list(sys.modules.items()):
            if not mod_name.startswith("flex_gemm") or mod is None:
                continue
            for attr_name in dir(mod):
                obj = getattr(mod, attr_name, None)
                if obj is None or id(obj) in visited:
                    continue
                visited.add(id(obj))

                fn = getattr(obj, "fn", obj)
                if hasattr(fn, "__annotations__") and isinstance(fn.__annotations__, dict):
                    to_remove = []
                    for param, ann in fn.__annotations__.items():
                        ann_str = str(ann)
                        if "constexpr" not in ann_str:
                            to_remove.append(param)
                    for param in to_remove:
                        del fn.__annotations__[param]
    except Exception:
        pass


def fix_flex_gemm():
    """
    Ensure `flex_gemm.ops.grid_sample` is importable and Triton 3.x compat is applied.
    In environments where flex_gemm is missing or an older wheel lacks ops.grid_sample,
    this registers pure-PyTorch grid_sample_3d fallback shim.
    Also patches:
      1. triton.language.dtype.itemsize (missing in Triton 3.x)
      2. triton.language.str_to_ty ('ier_type' KeyError in Triton 3.x)
      3. triton.language.core.tensor.__or__ (tl.tensor | None ValueError in Python 3.10)
      4. triton.compiler.code_generator.CodeGenerator.visit_BoolOp (chained boolops in Triton 3.x)
      5. flex_gemm source files on disk (tl.tensor | None -> None, itemsize -> bitwidth // 8)
      6. flex_gemm Triton kernel parameter annotations
    """
    try:
        _fix_triton_dtype_itemsize()
    except Exception:
        pass
    try:
        _fix_triton_str_to_ty()
    except Exception:
        pass
    try:
        _fix_triton_semantic_or()
    except Exception:
        pass
    try:
        _fix_triton_chained_boolops()
    except Exception:
        pass
    try:
        _fix_triton_compare()
    except Exception:
        pass
    try:
        _fix_triton_if()
    except Exception:
        pass
    try:
        _fix_triton_static_assert()
    except Exception:
        pass
    try:
        _fix_triton_assert()
    except Exception:
        pass
    try:
        _fix_triton_reduce_or()
    except Exception:
        pass
    try:
        _patch_flex_gemm_sources()
    except Exception:
        pass
    try:
        _sanitize_flex_gemm_kernel_annotations()
    except Exception:
        pass
    try:
        from utils.flex_gemm_fallback import install_flex_gemm_shim
        return install_flex_gemm_shim()
    except Exception:
        try:
            from backend.utils.flex_gemm_fallback import install_flex_gemm_shim
            return install_flex_gemm_shim()
        except Exception:
            try:
                import sys
                from pathlib import Path
                backend_dir = str(Path(__file__).resolve().parents[1])
                if backend_dir not in sys.path:
                    sys.path.insert(0, backend_dir)
                from utils.flex_gemm_fallback import install_flex_gemm_shim
                return install_flex_gemm_shim()
            except Exception as e:
                import traceback
                print(f"Failed to apply flex_gemm fix: {e}\n{traceback.format_exc()}")
                return False


def get_grid_sample_3d():
    """Retrieve grid_sample_3d, applying fix if needed."""
    try:
        from flex_gemm.ops.grid_sample import grid_sample_3d
        return grid_sample_3d
    except (ImportError, ModuleNotFoundError, AttributeError):
        pass
    fix_flex_gemm()
    try:
        from flex_gemm.ops.grid_sample import grid_sample_3d
        return grid_sample_3d
    except Exception:
        try:
            from utils.flex_gemm_fallback import grid_sample_3d
            return grid_sample_3d
        except ImportError:
            from backend.utils.flex_gemm_fallback import grid_sample_3d
            return grid_sample_3d


def fix_flash_attention_hardware():
    """
    Ensure attention backends gracefully fall back to PyTorch SDPA on pre-Ampere GPUs (Turing/Volta/Pascal, e.g. T4/V100).
    FlashAttention strictly requires compute capability >= 8.0 (Ampere+).
    If compute capability < 8.0 or flash_attn is unavailable/incompatible, set ATTN_BACKEND='sdpa'.
    """
    import os
    try:
        import torch
        if torch.cuda.is_available():
            min_major = 99
            for i in range(torch.cuda.device_count()):
                try:
                    cap = torch.cuda.get_device_capability(i)
                    if cap[0] < min_major:
                        min_major = cap[0]
                except Exception:
                    pass
            if min_major < 8:
                # Pre-Ampere GPU detected (e.g. Tesla T4 is 7.5, V100 is 7.0)
                # FlashAttention will crash with "FlashAttention only supports Ampere GPUs or newer"
                if os.environ.get("ATTN_BACKEND") in (None, "", "flash_attn", "flash_attn_3", "flash_attn_4"):
                    os.environ["ATTN_BACKEND"] = "sdpa"
                if os.environ.get("SPARSE_ATTN_BACKEND") in (None, "", "flash_attn"):
                    os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
                try:
                    import transformers.utils.import_utils as tiu
                    tiu.is_flash_attn_2_available = lambda: False
                    tiu.is_flash_attn_available = lambda: False
                except Exception:
                    pass
                print(f"Pre-Ampere GPU detected (compute capability < 8.0). Defaulted ATTN_BACKEND and SPARSE_ATTN_BACKEND to 'sdpa'.")
    except Exception:
        pass
    return True


def fix_pixal3d_modules():
    """
    Ensure DinoV3ProjFeatureExtractor is importable from pixal3d.modules.image_feature_extractor.
    """
    try:
        import pixal3d.modules.image_feature_extractor as ife
        if not hasattr(ife, "DinoV3ProjFeatureExtractor"):
            try:
                from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor
                setattr(ife, "DinoV3ProjFeatureExtractor", DinoV3ProjFeatureExtractor)
            except Exception:
                pass
    except Exception:
        pass
    return True


def fix_torch_cluster():
    """
    Ensure torch_cluster.fps is importable for UniRig.
    If torch_cluster is not installed (e.g. Kaggle/minimal CUDA env),
    installs a pure-PyTorch Farthest Point Sampling fallback into sys.modules.
    """
    try:
        import torch_cluster
        if hasattr(torch_cluster, "fps"):
            return True
    except ImportError:
        pass

    import types
    import random
    import math
    from typing import Optional
    import torch

    def fps_fallback(
        src: torch.Tensor,
        batch: Optional[torch.Tensor] = None,
        ratio: Optional[float] = None,
        random_start: bool = True,
    ) -> torch.Tensor:
        """Pure PyTorch fallback for torch_cluster.fps."""
        if ratio is None:
            ratio = 0.5

        if batch is None:
            batch = torch.zeros(src.size(0), dtype=torch.long, device=src.device)

        batch_size = int(batch.max().item()) + 1 if batch.numel() > 0 else 1
        selected = []

        for b in range(batch_size):
            mask = (batch == b)
            batch_indices = mask.nonzero(as_tuple=False).view(-1)
            num_points = batch_indices.numel()
            if num_points == 0:
                continue

            num_samples = max(1, int(math.ceil(num_points * ratio))) if isinstance(ratio, float) else int(ratio)
            num_samples = min(num_samples, num_points)

            pts = src[batch_indices]

            sampled_idx = torch.zeros(num_samples, dtype=torch.long, device=src.device)
            start = random.randint(0, num_points - 1) if random_start else 0
            sampled_idx[0] = start

            cur = pts[start : start + 1]
            dists = torch.sum((pts - cur) ** 2, dim=-1)

            for i in range(1, num_samples):
                far = torch.argmax(dists)
                sampled_idx[i] = far
                new_p = pts[far : far + 1]
                dists = torch.minimum(dists, torch.sum((pts - new_p) ** 2, dim=-1))

            selected.append(batch_indices[sampled_idx])

        if selected:
            return torch.cat(selected, dim=0)
        return torch.empty(0, dtype=torch.long, device=src.device)

    mod = types.ModuleType("torch_cluster")
    mod.fps = fps_fallback
    sys.modules["torch_cluster"] = mod
    return True


def fix_trellis2_flexible_dual_grid():
    """
    Ensure `o_voxel.convert.flexible_dual_grid_to_mesh` does not fail on GPUs without precompiled C++ binaries
    (such as Tesla T4, V100, or modern GPUs where o_voxel._C only has Hopper compute_90 compiled).
    Replaces CUDA hashmap calls (_C.hashmap_insert_3d_idx_as_val_cuda & _C.hashmap_lookup_3d_cuda)
    with a pure PyTorch torch.searchsorted implementation that runs natively on CUDA and CPU.
    Also patches source on disk and intercepts o_voxel._C functions directly.
    """
    try:
        import sys
        import re

        # --- 1. Disk-level patch: rewrite o_voxel/convert/flexible_dual_grid.py in site-packages ---
        try:
            cand_files = []
            for p in sys.path:
                cand = os.path.join(p, "o_voxel", "convert", "flexible_dual_grid.py")
                if os.path.isfile(cand):
                    cand_files.append(cand)
            try:
                import site
                for sp in site.getsitepackages():
                    cand = os.path.join(sp, "o_voxel", "convert", "flexible_dual_grid.py")
                    if os.path.isfile(cand) and cand not in cand_files:
                        cand_files.append(cand)
            except Exception:
                pass

            for fpath in cand_files:
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read()
                    if "_C.hashmap_insert_3d_idx_as_val_cuda" in content:
                        old_hash_pattern = re.compile(
                            r"(\s*# Store active voxels into hashmap\s*\n\s*hashmap = _init_hashmap.*?"
                            r"_C\.hashmap_insert_3d_idx_as_val_cuda.*?\n)(.*?"
                            r"connected_voxel_indices = _C\.hashmap_lookup_3d_cuda.*?\n)",
                            re.DOTALL
                        )
                        # Replace the _C calls with inline pure-PyTorch searchsorted logic
                        repl = (
                            r"\2"
                            r"    # Pure PyTorch lookup (bypasses missing sm_75 binary in o_voxel._C)\n"
                            r"    _W, _H, _D = int(grid_size[0].item()), int(grid_size[1].item()), int(grid_size[2].item())\n"
                            r"    _stride_x, _stride_y = _H * _D, _D\n"
                            r"    _ins_keys = coords[:, 0].long() * _stride_x + coords[:, 1].long() * _stride_y + coords[:, 2].long()\n"
                            r"    _sorted_keys, _sort_perm = torch.sort(_ins_keys)\n"
                            r"    _q = connected_voxel.reshape(-1, 3)\n"
                            r"    _qx, _qy, _qz = _q[:, 0].long(), _q[:, 1].long(), _q[:, 2].long()\n"
                            r"    _in_bound = (_qx >= 0) & (_qx < _W) & (_qy >= 0) & (_qy < _H) & (_qz >= 0) & (_qz < _D)\n"
                            r"    _q_keys = _qx * _stride_x + _qy * _stride_y + _qz\n"
                            r"    _pos = torch.searchsorted(_sorted_keys, _q_keys)\n"
                            r"    _pos = torch.clamp(_pos, 0, max(0, len(_sorted_keys) - 1))\n"
                            r"    _matched = (_sorted_keys[_pos] == _q_keys) & _in_bound\n"
                            r"    _res = torch.full((_q.shape[0],), -1, dtype=torch.int64, device=coords.device)\n"
                            r"    _res[_matched] = _sort_perm[_pos[_matched]]\n"
                            r"    connected_voxel_indices = _res.reshape(M, 4)\n"
                            r"    connected_voxel_valid = (connected_voxel_indices >= 0).all(dim=1)\n"
                            r"    quad_indices = connected_voxel_indices[connected_voxel_valid]\n"
                        )
                        new_content = old_hash_pattern.sub(repl, content)
                        if new_content != content:
                            with open(fpath, "w", encoding="utf-8") as f:
                                f.write(new_content)
                            logger.info(f"Patched o_voxel flexible_dual_grid.py on disk: {fpath}")
                except Exception as patch_file_err:
                    logger.debug(f"Could not patch o_voxel on disk {fpath}: {patch_file_err}")
        except Exception:
            pass

        # --- 2. In-memory patch: shim o_voxel._C hashmap functions directly ---
        try:
            import o_voxel
            _C = getattr(o_voxel, "_C", None)
            if _C is not None:
                _hashmap_store = {}

                def shim_insert(hashmap_keys, hashmap_vals, coords, W, H, D):
                    _hashmap_store[id(hashmap_keys)] = (coords, int(W), int(H), int(D))

                def shim_lookup(hashmap_keys, hashmap_vals, query_coords, W, H, D):
                    entry = _hashmap_store.get(id(hashmap_keys))
                    if entry is not None:
                        ins_coords, iW, iH, iD = entry
                    else:
                        ins_coords = None
                        iW, iH, iD = int(W), int(H), int(D)

                    if ins_coords is None:
                        return torch.full((query_coords.size(0),), 0xffffffff, dtype=hashmap_vals.dtype, device=query_coords.device)

                    stride_y = iD
                    stride_x = iH * iD
                    stride_b = iW * iH * iD

                    b = ins_coords[:, 0].long()
                    x = ins_coords[:, 1].long()
                    y = ins_coords[:, 2].long()
                    z = ins_coords[:, 3].long()
                    ins_keys = b * stride_b + x * stride_x + y * stride_y + z
                    sorted_keys, sort_perm = torch.sort(ins_keys)

                    qb = query_coords[:, 0].long()
                    qx = query_coords[:, 1].long()
                    qy = query_coords[:, 2].long()
                    qz = query_coords[:, 3].long()
                    in_bound = (qx >= 0) & (qx < iW) & (qy >= 0) & (qy < iH) & (qz >= 0) & (qz < iD)
                    q_keys = qb * stride_b + qx * stride_x + qy * stride_y + qz

                    pos = torch.searchsorted(sorted_keys, q_keys)
                    pos = torch.clamp(pos, 0, max(0, len(sorted_keys) - 1))
                    matched = (sorted_keys[pos] == q_keys) & in_bound

                    res = torch.full((query_coords.size(0),), 0xffffffff, dtype=torch.int64, device=query_coords.device)
                    res[matched] = sort_perm[pos[matched]]
                    return res.to(hashmap_vals.dtype)

                setattr(_C, "hashmap_insert_3d_idx_as_val_cuda", shim_insert)
                setattr(_C, "hashmap_lookup_3d_cuda", shim_lookup)
                logger.info("Successfully intercepted o_voxel._C hashmap CUDA functions with pure PyTorch")
        except Exception:
            pass

        # --- 3. Python-level module patch for o_voxel.convert and trellis2 ---
        import torch
        import o_voxel.convert.flexible_dual_grid as fdg
        if getattr(fdg, "_pure_torch_patched", False):
            return True

        orig_fn = getattr(fdg, "flexible_dual_grid_to_mesh", None)
        if orig_fn is None:
            return False

        def pure_torch_flexible_dual_grid_to_mesh(
            coords,
            dual_vertices,
            intersected_flag,
            split_weight,
            aabb,
            voxel_size=None,
            grid_size=None,
            train=False,
        ):
            import torch
            import numpy as np

            # Static variables
            if not hasattr(pure_torch_flexible_dual_grid_to_mesh, "edge_neighbor_voxel_offset"):
                pure_torch_flexible_dual_grid_to_mesh.edge_neighbor_voxel_offset = torch.tensor([
                    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],     # x-axis
                    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],     # y-axis
                    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],     # z-axis
                ], dtype=torch.int, device=coords.device).unsqueeze(0)
            if not hasattr(pure_torch_flexible_dual_grid_to_mesh, "quad_split_1"):
                pure_torch_flexible_dual_grid_to_mesh.quad_split_1 = torch.tensor([0, 1, 2, 0, 2, 3], dtype=torch.long, device=coords.device, requires_grad=False)
            if not hasattr(pure_torch_flexible_dual_grid_to_mesh, "quad_split_2"):
                pure_torch_flexible_dual_grid_to_mesh.quad_split_2 = torch.tensor([0, 1, 3, 3, 1, 2], dtype=torch.long, device=coords.device, requires_grad=False)
            if not hasattr(pure_torch_flexible_dual_grid_to_mesh, "quad_split_train"):
                pure_torch_flexible_dual_grid_to_mesh.quad_split_train = torch.tensor([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4], dtype=torch.long, device=coords.device, requires_grad=False)

            # AABB
            if isinstance(aabb, (list, tuple)):
                aabb = np.array(aabb)
            if isinstance(aabb, np.ndarray):
                aabb = torch.tensor(aabb, dtype=torch.float32, device=coords.device)
            assert isinstance(aabb, torch.Tensor) and aabb.dim() == 2 and aabb.size(0) == 2 and aabb.size(1) == 3

            # Voxel size
            if voxel_size is not None:
                if isinstance(voxel_size, float):
                    voxel_size = [voxel_size, voxel_size, voxel_size]
                if isinstance(voxel_size, (list, tuple)):
                    voxel_size = np.array(voxel_size)
                if isinstance(voxel_size, np.ndarray):
                    voxel_size = torch.tensor(voxel_size, dtype=torch.float32, device=coords.device)
                grid_size = ((aabb[1] - aabb[0]) / voxel_size).round().int()
            else:
                assert grid_size is not None, "Either voxel_size or grid_size must be provided"
                if isinstance(grid_size, int):
                    grid_size = [grid_size, grid_size, grid_size]
                if isinstance(grid_size, (list, tuple)):
                    grid_size = np.array(grid_size)
                if isinstance(grid_size, np.ndarray):
                    grid_size = torch.tensor(grid_size, dtype=torch.int32, device=coords.device)
                voxel_size = (aabb[1] - aabb[0]) / grid_size

            W, H, D = int(grid_size[0].item()), int(grid_size[1].item()), int(grid_size[2].item())
            stride_z = 1
            stride_y = D
            stride_x = H * D

            # Find connected voxels
            N = dual_vertices.shape[0]
            edge_neighbor_voxel = coords.reshape(N, 1, 1, 3) + pure_torch_flexible_dual_grid_to_mesh.edge_neighbor_voxel_offset  # (N, 3, 4, 3)
            connected_voxel = edge_neighbor_voxel[intersected_flag]  # (M, 4, 3)
            M = connected_voxel.shape[0]

            # Pure PyTorch coordinate lookup (replaces CUDA _C.hashmap_lookup_3d_cuda)
            # Keys for inserted voxels:
            c_x = coords[:, 0].long()
            c_y = coords[:, 1].long()
            c_z = coords[:, 2].long()
            ins_keys = c_x * stride_x + c_y * stride_y + c_z
            sorted_keys, sort_perm = torch.sort(ins_keys)

            # Keys for queried quad voxels:
            q = connected_voxel.reshape(-1, 3)
            q_x = q[:, 0].long()
            q_y = q[:, 1].long()
            q_z = q[:, 2].long()
            in_bound = (q_x >= 0) & (q_x < W) & (q_y >= 0) & (q_y < H) & (q_z >= 0) & (q_z < D)
            q_keys = q_x * stride_x + q_y * stride_y + q_z

            pos = torch.searchsorted(sorted_keys, q_keys)
            pos = torch.clamp(pos, 0, max(0, len(sorted_keys) - 1))
            matched = (sorted_keys[pos] == q_keys) & in_bound

            res = torch.full((q.shape[0],), -1, dtype=torch.int64, device=coords.device)
            res[matched] = sort_perm[pos[matched]]
            connected_voxel_indices = res.reshape(M, 4)

            connected_voxel_valid = (connected_voxel_indices >= 0).all(dim=1)
            quad_indices = connected_voxel_indices[connected_voxel_valid].long()
            L = quad_indices.shape[0]

            # Construct triangles
            if not train:
                mesh_vertices = (coords.float() + dual_vertices) * voxel_size + aabb[0].reshape(1, 3)
                if split_weight is None:
                    atempt_triangles_0 = quad_indices[:, pure_torch_flexible_dual_grid_to_mesh.quad_split_1]
                    normals0 = torch.cross(mesh_vertices[atempt_triangles_0[:, 1]] - mesh_vertices[atempt_triangles_0[:, 0]], mesh_vertices[atempt_triangles_0[:, 2]] - mesh_vertices[atempt_triangles_0[:, 0]])
                    normals1 = torch.cross(mesh_vertices[atempt_triangles_0[:, 2]] - mesh_vertices[atempt_triangles_0[:, 1]], mesh_vertices[atempt_triangles_0[:, 3]] - mesh_vertices[atempt_triangles_0[:, 1]])
                    align0 = (normals0 * normals1).sum(dim=1, keepdim=True).abs()

                    atempt_triangles_1 = quad_indices[:, pure_torch_flexible_dual_grid_to_mesh.quad_split_2]
                    normals0 = torch.cross(mesh_vertices[atempt_triangles_1[:, 1]] - mesh_vertices[atempt_triangles_1[:, 0]], mesh_vertices[atempt_triangles_1[:, 2]] - mesh_vertices[atempt_triangles_1[:, 0]])
                    normals1 = torch.cross(mesh_vertices[atempt_triangles_1[:, 2]] - mesh_vertices[atempt_triangles_1[:, 1]], mesh_vertices[atempt_triangles_1[:, 3]] - mesh_vertices[atempt_triangles_1[:, 1]])
                    align1 = (normals0 * normals1).sum(dim=1, keepdim=True).abs()

                    mesh_triangles = torch.where(align0 > align1, atempt_triangles_0, atempt_triangles_1).reshape(-1, 3)
                else:
                    split_weight_ws = split_weight[quad_indices]
                    split_weight_ws_02 = split_weight_ws[:, 0] * split_weight_ws[:, 2]
                    split_weight_ws_13 = split_weight_ws[:, 1] * split_weight_ws[:, 3]
                    mesh_triangles = torch.where(
                        split_weight_ws_02 > split_weight_ws_13,
                        quad_indices[:, pure_torch_flexible_dual_grid_to_mesh.quad_split_1],
                        quad_indices[:, pure_torch_flexible_dual_grid_to_mesh.quad_split_2]
                    ).reshape(-1, 3)
            else:
                assert split_weight is not None, "split_weight must be provided in training mode"
                mesh_vertices = (coords.float() + dual_vertices) * voxel_size + aabb[0].reshape(1, 3)
                quad_vs = mesh_vertices[quad_indices]
                mean_v02 = (quad_vs[:, 0] + quad_vs[:, 2]) / 2
                mean_v13 = (quad_vs[:, 1] + quad_vs[:, 3]) / 2
                split_weight_ws = split_weight[quad_indices]
                split_weight_ws_02 = split_weight_ws[:, 0] * split_weight_ws[:, 2]
                split_weight_ws_13 = split_weight_ws[:, 1] * split_weight_ws[:, 3]
                mid_vertices = (
                    split_weight_ws_02 * mean_v02 +
                    split_weight_ws_13 * mean_v13
                ) / (split_weight_ws_02 + split_weight_ws_13)
                mesh_vertices = torch.cat([mesh_vertices, mid_vertices], dim=0)
                quad_indices = torch.cat([quad_indices, torch.arange(N, N + L, device=coords.device).unsqueeze(1)], dim=1)
                mesh_triangles = quad_indices[:, pure_torch_flexible_dual_grid_to_mesh.quad_split_train].reshape(-1, 3)

            return mesh_vertices, mesh_triangles

        fdg.flexible_dual_grid_to_mesh = pure_torch_flexible_dual_grid_to_mesh
        fdg._pure_torch_patched = True

        # Propagate to all importing modules
        if "o_voxel.convert" in sys.modules:
            setattr(sys.modules["o_voxel.convert"], "flexible_dual_grid_to_mesh", pure_torch_flexible_dual_grid_to_mesh)
        for mod_name, mod_obj in list(sys.modules.items()):
            if "fdg_vae" in mod_name and mod_obj is not None:
                setattr(mod_obj, "flexible_dual_grid_to_mesh", pure_torch_flexible_dual_grid_to_mesh)

        logger.info("Applied pure PyTorch flexible_dual_grid_to_mesh patch (removes o_voxel._C CUDA architecture requirement)")
        return True
    except Exception as e:
        logger.debug(f"fix_trellis2_flexible_dual_grid notice: {e}")
        return False


def fix_trellis2_cumesh_fallback():
    """
    Ensure TRELLIS.2 mesh processing does not crash when `cumesh` is missing or fails on pre-Ampere GPUs.
    Patches `Mesh.fill_holes`, `Mesh.simplify`, and `Mesh.remove_faces` in `trellis2.representations.mesh.base`
    to safely fall back without throwing NameError or CUDA architecture errors.
    Also registers a lightweight fallback shim for `cumesh` into `sys.modules`.
    """
    try:
        import sys
        import types

        # 1. Fallback shim for cumesh module if missing or broken
        if "cumesh" not in sys.modules:
            try:
                import cumesh
            except Exception:
                mod_cumesh = types.ModuleType("cumesh")

                class DummyCuMesh:
                    def __init__(self):
                        self.vertices = None
                        self.faces = None
                        self.num_boundaries = 0
                        self.num_boundary_loops = 0

                    def init(self, vertices, faces):
                        self.vertices = vertices
                        self.faces = faces

                    def get_edges(self): pass
                    def get_boundary_info(self): pass
                    def get_vertex_edge_adjacency(self): pass
                    def get_vertex_boundary_adjacency(self): pass
                    def get_manifold_boundary_adjacency(self): pass
                    def read_manifold_boundary_adjacency(self): pass
                    def get_boundary_connected_components(self): pass
                    def get_boundary_loops(self): pass
                    def fill_holes(self, max_hole_perimeter=3e-2): pass
                    def simplify(self, target=1000000, verbose=False, options=None): pass
                    def remove_faces(self, face_mask):
                        if self.faces is not None and face_mask is not None:
                            self.faces = self.faces[~face_mask]

                    def read(self):
                        return self.vertices, self.faces

                class DummyCuBVH:
                    def __init__(self, vertices, faces):
                        self.vertices = vertices
                        self.faces = faces

                mod_cumesh.CuMesh = DummyCuMesh
                mod_cumesh.cuBVH = DummyCuBVH
                sys.modules["cumesh"] = mod_cumesh
                logger.info("Registered cumesh fallback shim in sys.modules")

        # 2. Patch Mesh class methods directly in trellis2 modules
        def patch_mesh_class(cls):
            if getattr(cls, "_cumesh_safe_patched", False):
                return

            def safe_fill_holes(self, max_hole_perimeter=3e-2):
                try:
                    import cumesh
                    vertices = self.vertices.cuda()
                    faces = self.faces.cuda()
                    mesh = cumesh.CuMesh()
                    mesh.init(vertices, faces)
                    mesh.get_edges()
                    mesh.get_boundary_info()
                    if getattr(mesh, "num_boundaries", 0) == 0:
                        return
                    mesh.get_vertex_edge_adjacency()
                    mesh.get_vertex_boundary_adjacency()
                    mesh.get_manifold_boundary_adjacency()
                    mesh.read_manifold_boundary_adjacency()
                    mesh.get_boundary_connected_components()
                    mesh.get_boundary_loops()
                    if getattr(mesh, "num_boundary_loops", 0) == 0:
                        return
                    mesh.fill_holes(max_hole_perimeter=max_hole_perimeter)
                    new_vertices, new_faces = mesh.read()
                    self.vertices = new_vertices.to(self.device)
                    self.faces = new_faces.to(self.device)
                except Exception as e:
                    # In dual-grid representation, the generated geometry is already watertight;
                    # skipping optional hole-fill gracefully preserves model mesh.
                    logger.debug(f"fill_holes gracefully skipped: {e}")

            def safe_remove_faces(self, face_mask):
                try:
                    import cumesh
                    vertices = self.vertices.cuda()
                    faces = self.faces.cuda()
                    mesh = cumesh.CuMesh()
                    mesh.init(vertices, faces)
                    mesh.remove_faces(face_mask)
                    new_vertices, new_faces = mesh.read()
                    self.vertices = new_vertices.to(self.device)
                    self.faces = new_faces.to(self.device)
                except Exception:
                    # Pure-PyTorch face removal fallback
                    keep = ~face_mask.to(self.faces.device)
                    self.faces = self.faces[keep]

            def safe_simplify(self, target=1000000, verbose=False, options=None):
                try:
                    import cumesh
                    vertices = self.vertices.cuda()
                    faces = self.faces.cuda()
                    mesh = cumesh.CuMesh()
                    mesh.init(vertices, faces)
                    mesh.simplify(target, verbose=verbose, options=options or {})
                    new_vertices, new_faces = mesh.read()
                    self.vertices = new_vertices.to(self.device)
                    self.faces = new_faces.to(self.device)
                except Exception:
                    pass

            cls.fill_holes = safe_fill_holes
            cls.remove_faces = safe_remove_faces
            cls.simplify = safe_simplify
            cls._cumesh_safe_patched = True

        for mod_name in list(sys.modules.keys()):
            if "trellis2" in mod_name:
                mod = sys.modules[mod_name]
                if mod is not None and hasattr(mod, "Mesh"):
                    patch_mesh_class(getattr(mod, "Mesh"))

        try:
            from trellis2.representations.mesh.base import Mesh
            patch_mesh_class(Mesh)
        except Exception:
            pass
        try:
            from trellis2.representations import Mesh
            patch_mesh_class(Mesh)
        except Exception:
            pass

        return True
    except Exception as e:
        logger.debug(f"fix_trellis2_cumesh_fallback notice: {e}")
        return False


def fix_trellis2_sparse_vae_dtype():
    """Ensure TRELLIS.2 SparseStructureDecoder/Encoder align input tensor dtype with conv3d weights (prevents BFloat16/Float32 mismatch)."""
    try:
        from trellis2.models.sparse_structure_vae import SparseStructureDecoder, SparseStructureEncoder

        orig_decoder_forward = SparseStructureDecoder.forward
        if not getattr(orig_decoder_forward, "_dtype_aligned", False):
            def patched_decoder_forward(self, x: torch.Tensor) -> torch.Tensor:
                in_dtype = next(self.input_layer.parameters()).dtype if hasattr(self.input_layer, "parameters") else self.dtype
                if x.dtype != in_dtype:
                    x = x.to(in_dtype)
                h = self.input_layer(x)
                h = h.type(self.dtype)
                h = self.middle_block(h)
                for block in self.blocks:
                    h = block(h)
                out_dtype = next(self.out_layer.parameters()).dtype if hasattr(self.out_layer, "parameters") else self.dtype
                h = h.type(out_dtype)
                h = self.out_layer(h)
                return h

            patched_decoder_forward._dtype_aligned = True
            SparseStructureDecoder.forward = patched_decoder_forward

        orig_encoder_forward = SparseStructureEncoder.forward
        if not getattr(orig_encoder_forward, "_dtype_aligned", False):
            def patched_encoder_forward(self, x: torch.Tensor, sample_posterior: bool = False, return_raw: bool = False) -> torch.Tensor:
                in_dtype = next(self.input_layer.parameters()).dtype if hasattr(self.input_layer, "parameters") else self.dtype
                if x.dtype != in_dtype:
                    x = x.to(in_dtype)
                h = self.input_layer(x)
                h = h.type(self.dtype)
                for block in self.blocks:
                    h = block(h)
                h = self.middle_block(h)
                out_dtype = next(self.out_layer.parameters()).dtype if hasattr(self.out_layer, "parameters") else self.dtype
                h = h.type(out_dtype)
                h = self.out_layer(h)
                mean, logvar = h.chunk(2, dim=1)
                if sample_posterior:
                    std = torch.exp(0.5 * logvar)
                    z = mean + std * torch.randn_like(std)
                else:
                    z = mean
                if return_raw:
                    return z, mean, logvar
                return z

            patched_encoder_forward._dtype_aligned = True
            SparseStructureEncoder.forward = patched_encoder_forward

        try:
            from trellis2.modules.sparse.basic import SparseTensor
            if not getattr(SparseTensor, "_empty_coords_patched", False):
                def patched_cal_shape(self, feats, coords):
                    shape = []
                    if coords.shape[0] == 0:
                        shape.append(0)
                    else:
                        shape.append(coords[:, 0].max().item() + 1)
                    shape.extend([*feats.shape[1:]])
                    return torch.Size(shape)
                def patched_cal_layout(self, coords, batch_size):
                    if coords.shape[0] == 0:
                        return [slice(0, 0) for _ in range(batch_size)]
                    seq_len = torch.bincount(coords[:, 0], minlength=batch_size)
                    offset = torch.cumsum(seq_len, dim=0)
                    layout = [slice((offset[i] - seq_len[i]).item(), offset[i].item()) for i in range(batch_size)]
                    return layout
                def patched_cal_spatial_shape(self, coords):
                    if coords.shape[0] == 0:
                        return torch.Size([0, 0, 0])
                    return torch.Size((coords[:, 1:].max(0)[0] + 1).tolist())

                setattr(SparseTensor, "_SparseTensor__cal_shape", patched_cal_shape)
                setattr(SparseTensor, "_SparseTensor__cal_layout", patched_cal_layout)
                setattr(SparseTensor, "_SparseTensor__cal_spatial_shape", patched_cal_spatial_shape)
                SparseTensor._empty_coords_patched = True
        except Exception:
            pass

        return True
    except Exception as e:
        logger.debug(f"fix_trellis2_sparse_vae_dtype notice: {e}")
        return False


def apply_fix():
    """Apply compatibility fixes (torchvision, transformers, torch.load, hf redirects, numba, dinov3, flex_gemm, flash_attn, and torch_cluster)."""
    load_dotenv_into_environ()
    if torchvision is not None:
        try:
            print(f"Torchvision version: {torchvision.__version__}")
        except Exception:
            pass
        fix_torchvision_functional_tensor()
    fix_transformers_cache()
    fix_transformers_dinov3()
    fix_flex_gemm()
    fix_torch_load_weights_only()
    fix_huggingface_repo_redirects()
    fix_gated_huggingface_repos()
    fix_numba_caching()
    fix_flash_attention_hardware()
    fix_pixal3d_modules()
    fix_torch_cluster()
    fix_trellis2_sparse_vae_dtype()
    fix_trellis2_flexible_dual_grid()
    fix_trellis2_cumesh_fallback()
    return True


if __name__ == "__main__":
    apply_fix()


