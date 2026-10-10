import os
REDIS_URL = os.environ['REDIS_URL']
REDIS_SSL = False
from plane.settings.test import *
LAB_AUTH_ENABLED = True
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_BROKER_URL = "memory://"
