from typing import *

BACKEND = 'flash_attn' 
DEBUG = False

def __from_env():
    import os
    import torch
    
    global BACKEND
    global DEBUG
    
    env_attn_backend = os.environ.get('ATTN_BACKEND')
    env_sttn_debug = os.environ.get('ATTN_DEBUG')
    
    if env_attn_backend is not None and env_attn_backend in ['xformers', 'flash_attn', 'sdpa', 'naive']:
        BACKEND = env_attn_backend
    else:
        # Auto-detect best attention backend supported by hardware
        if torch.cuda.is_available():
            try:
                major, _ = torch.cuda.get_device_capability()
                if major >= 8:
                    try:
                        import flash_attn
                        BACKEND = 'flash_attn'
                    except Exception:
                        BACKEND = 'sdpa'
                else:
                    # Pre-Ampere GPUs (T4, V100, RTX 20xx, GTX 16xx) do NOT support FlashAttention
                    BACKEND = 'sdpa'
            except Exception:
                BACKEND = 'sdpa'
        else:
            BACKEND = 'sdpa'

    if env_sttn_debug is not None:
        DEBUG = env_sttn_debug == '1'

    print(f"[ATTENTION] Using backend: {BACKEND}")
        

__from_env()
    

def set_backend(backend: Literal['xformers', 'flash_attn']):
    global BACKEND
    BACKEND = backend

def set_debug(debug: bool):
    global DEBUG
    DEBUG = debug


from .full_attn import *
from .modules import *
