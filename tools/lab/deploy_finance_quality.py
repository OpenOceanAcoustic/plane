#!/usr/bin/env python3
"""Publish the worker-first finance and quality workbench.

Run on the deployment host as root:

    sudo python3 /tmp/deploy-finance-quality.py

The reviewed workbench bundle is embedded in this script, so deployment needs
only this one file. It checks the deployment is based on a known workbench
revision, installs the source files, builds the web client with the repository
toolchain, commits the source change, and publishes the static bundle. Hashed
assets are additive; index.html is replaced last after a production smoke test.
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(os.environ.get("PLANE_REPO", "/mnt/repo/kanban/plane")).resolve()
RUNTIME = REPO / ".temp/lab-runtime/web"
BUILD = REPO / "apps/web/build/client"
LOCAL_URL = os.environ.get("PLANE_LOCAL_URL", "http://127.0.0.1:50020")
PUBLIC_URL = os.environ.get("PLANE_PUBLIC_URL", "https://plane.oceanacoustic.top")

BUNDLE_SHA256 = "6a125e4048500621ba1a42468bb64bc4149c311fb636cda5f5897b4bb0083e56"
# The reviewed workbench bundle is embedded so deployment never needs a second
# network request. Run this file once; it is a complete snapshot.
BUNDLE_B64 = """
H4sIAAAAAAAAA9Q8a5McxZF85leUOghHD56ZXQkQF6t9nLQSPp0lpJOEubiNjVVPd81OWz3dQz92NQwTIcCCNWcjuBAGbDBgWzYR1q2AE2AQ4Ah+yh0zu/p0f+Eyq6rr0d0zWiG48+0HNF2VVfmorMyszCqcXi+Z2aStGTeKKfyn24tCGqbJTOC0Ztp+6IQubabJxfvu4W8W/g4+/DD+u//RRw7o/87OHjjw0KMHDty3/5EDBw/un334IWzff/DhRw7eR2bvBele/7IkdWJC7nuqNx3uTv3/T/9mHnyQLEe9fuyvd1JiuzVyYPbAQXKqR8NTLnXCw24EEvJd4oQecaMwjf1WlkZx0iRnTx/958YJ36VhQhvHPdAav+3TeI4c/tHpE42HmrONKAz65MGZ+33QqjglA5Il9Fi7Td20jj/P0Db792zqpJQMSTuOusSKqeOm1qF8UNrvURh5Blsfj7yJcIP7CTnihBfCKKV1/B1FF5AL/L0c+L1W5MTeCT9JWUPkhwn++JGfHolBxzv4ccLpR1l61Ek6DBibTvvr632cln0EGRt0hrrU76Xn6EU22dmOTwNvuUNdBnXO79KY/Yhp6Pnh+hM9/HrSCQIK8Dn5Qeb6Hm1Uc3uCdR4HeZPp8AMStRIab9BYAnaj1sUyGIqZOrHbOe3ETjcxpdiIgW8aK3iEfvKMAEk24zKBTussaIFajb/vBU5IZ5KOE1OvkeCKVg06EmVh2j+SeesgC2x4jJuYk07orNMu6JDeegr42vDpJmtTICD/KPaKqBFJorN8JEvTKKwTsGRHqet3nYCtmPb9ROinCWs4HvaydDlwkqQ4bebrcyrajlJYTnrUd4JoXY5p5iaz4bHuKhHo431tgSeP1YcddnEQR1snjuuiQH/shx6A0ACYaetwvLECRTuKuzqC0jJMZKwrQQqTCA5LM3FK7mYmOcmTUXyhRXF3kpMULI9bMctmDjNF1sudKKHhREKK2HEg6LbrJGkuaN7UzQLnmOeD4k+YBfor2DhN466fJHLdKgb3JEhSoOR0HP0UDCbfMtrIHm9vtFhHtbKoRSBOUtl+GlQ8mLo2hZl/sswpOez9FPwCm1qN3nAFOQ1HdhfGn6DQr4svYA0FKL7DcfnbQbT5EzAB2oiYdbKFx14YOjNDoouBD4rk+YnTCmgjhJ3egBZK+LQzYdTIQtje/noI9kngajRIELlOIDYNLA5zc6mTXCBJFrcdlyb3PrnUUDWnADEEHl+gadNNku+Cn6koZafAdn87C/nWOAmxX98eEKeLVoUM50j+e44ksP/CdfIMCbMggH+y0KNAPAU7XGPON6ZpFofEhp+EzCc9JyQuGtTHnS5dsMDGNiSviIa0IZjAnxHZ7PgphQHQFUabsdOzFtkkhAwEJQsLCwLvM0RrUjQsEes/L121yBw5//W1B8Sw4fkhJ2YGqcE5a4fuHyp2uZYl8+cISBd8dQLs+p5kdbhoM76iTeb13SjIujxqoN1e2icLxBr/+rnx6+/ubn8w+vI1C3z7HMlHzJFzK6uH1DAUZYDWOJ/+EHFpAF82QANwjSws6kEOH8wQLckh9wtR+21i70MszYCG62mnxtgUCzDf0+UOnh2E5JEWcAr7jv/T8CDGkY2NJGulASW9xkGSop5BRAfRAP+9/yH+bwKyCj0n7luLA0bVcH6mt3iotO6evzFp2VPUZBKBT8dt27jYcCCQJILARrBeoJFTJVVhng/X5t5stFElGHkBbaeC4ANyCA7qUMfTB7XWG4HTh+n3a2AIGOufoHli3Zpdp2fb/IOtkW2AMRTkAu0viAFNtshDHWXvYuMh0us3DgiVp56fdacofYkIMWcR8UzaMYfUajoM9Gs8ITSIQhdNK/L6+gQDplGMX/hVwSwIibMK3U3fM5gUi5ZOWL27Fiti8+4g2K5zsQF6lBAlYScAg9hIox5pQWR7AZ2El1RIVskWdyHjtyhfJjOvOLRWgDOlbPZDny5j+EQVXhQ2CXaKNEmwt5IUdrnT7YFZsTecIKP5rmfiCcEDHoWYmnfVmml0Ag09HJ0QxLae7jSWH7fqYGRSOH78CxjYOWIdTnxn5mzHCdc7jm+BnT4kEKVR6gTM2CM2biyTHN/KKmIEysy4OQdrQnyfudS2k6xbJ5wcpBA+yQ+JXQiuBb1kaYnMhrU6/kdS4WYxnJBSoAO2ENBhMqp4xM+cz2SjcfbYHflsJgEcS+3ZOnlUYuNRA86FuJjRrThUMBpQvT0ndfA/FEmXDZgrSPMWFzQspd6akyp8+2cLCA8Lb7UHlDhgPfSfxin5KB21arJmrRyHMK3nYFaaOnPCo83zhayXXU7HV678EKhBSNUXnjbnjJPnIpCN7qYTdanmv6zxpVu7f9qCVeDTWbd/97Od7df/69Kzo0+vjV//hP/Y/fhn3/zl5dFXl0cv/RZAOS4L+I6dwIMGgc48cpMhulc/dAsYR5ev7d78o8K48+YtdLpbH0AroBu/9c5o6+1vvnzz9u/eRqTbv7395uXx1RujFz+fjDpPFnCcViGe1rHffu+znd9scy4VDeNf/Hz35mc7V9/f+fDWaOvPO1/8arSFvO9+8Pz4tZtIxo0vDALgkOavRxK/TC1wAtwoSQ2WmSxhGo5E4eUdXAKIjnWPtt8bv/sXgB5vvTJ+6/ru9h9G279WqKMYNgeVqFmKgqPtOf04wjjEwMwXb/zStdtXLxmYoWP0y9d2rr4DeFDwDAJBr9745tYbCmEvi3sBnSBrdbjQ0e7cugK8ABeccoETEN5+8dXx29fGn78ihTHaegGEPnlpjXwPxylOynocJuYGFRpvfaowcjVC5n7+190bn6M2Mz3DFb18fXT5w/GH705GzdM8AmcGZ0UD4c3fjV56D9Zqd/s9TazsW6rN7l+/HP1G2zJu7HeTKJQYtHQTR8NPUCaeP4LCjt94eefWC9o2vfTKzvWrQqAfPzv+gCnpCx+N//33E5U0z6JxTG1xKjakyPcFTnXlud1Lz8Pn+ON/1bC+8cl4+2NlIq79avTShyjIL66Ux1Rrj0qkcTISmkJsgfpjEIKq8+ILMClo4vj6V5qAGU7eLddVh6veJVqaT9gION+K46op7fd2frG989xnRYHLDsX9L98F9WV6jF2oem9dnyh8lqXkqPPDbll9YTJun2BJd97XBM+/d196DghA1MwSo8hffmF05aPJGixTooh5CMdDepGdHLnHUUkEcA557tGWRyrVzc5OCeYI6+yQ0I5p0vkxizhm5UmJ9c/JbOIhAxLOPWHWbdFYnns4CSuJlsisozbomc1VQFBIdtq1Q3KwMPPHPbLA4jB9riYYfjt3BGu+Z7G4xWZENjEbGNJ4qSn687MXO4juhwOoASahVmZX90GsDAdTy9LIAKJPK0qIrY6dIvgiRb4gWubxEosXBiKm5LNhdgBmwdjpiTMnjFH5oENiAB4dfYg5cEgzKfBbh+OvhKRBQieBCV7wTxz/EJA3DTU2IeAFusoyFnHLGiZ3uZQtDDIsQ0Dn2OByMPw9Skexa1CYx7l74nnFZdlGppg88ZirJCbF56uzkou6jq48lfnuBd7Bpvkn9W3MNSHXakwGYbEHRutEtH48STLKh5+hbdvQxxUtAcmqJkxDzTYdtd12QD30CVqFtCCboZgrNKgfqM2oolAAivvHjSSMjkUkWSWJj6nv6eTlrksfKRumD/VEpp4Ny9P2E9Y07zapTjrRJq8XeNxeqe+pqIV6Ckuhlk7KjcMaUE3xCdASTCMlpht+kjNzRnwYRMxqBAwInj3qhMZxFIN1SE5EjseOFt1MFO0WRLHIXtGTPbBluD1MggygJSV1zb6v1vmZj+9nBh3TpzKapJpA8xLQYp4gOC8wzESiZ+aBgTLqS+T8krJUCw8MKJwlPPrEmePLeWlbk97wPLPLw/Ns7ho/jUveWSPyP0e4crPcH+HCyNuOMcmwdi6SOfHvETWkJKT8rCHz5UlBXnsVkl5OW1ldtK0WNvg0mRHzzlhTuFJxuMGYap7I3EljpMYfg9WXY8XM/Kqywh4UhPyQxFJD51gCmBPDUwWTVEYRt2ifz/2wriXDijLHzPkan3tALlDaO42Ioyw5ygSVxhkFejtRFnhnKBioU+ExLiu2Y8nQlDGS3ApyDRCBhliQpWbbD1IImWzewJNf+5TInnlGgDaVHrMYQ6kt+cEPICpRNgTH7BODeO3Qq6FTZXh5IlkW3m1b85AbEczNxUgvUjeD3c+/AtjmJ1lFgrE1rIMNw45VjcsoPOtsUIxenKQfukSf2Nl0/JSARQL/QZtwJLJXuOLYtbq5P1SDWja7tipcrWajbFvlmtgv0I79CkxzkbYsC3DiFcmBcoLlmAQ613zs1f0iNGIVauIAjMtFAGNNljPL10vkuFrGeu9TaoifBY+tDDooQT5JTcQgnP+JIyR8pZzyMOkCnDvwoBklsC1Fm8NAoDWBRZatPdicPssWyCQncByvYfiqmGiKtroE8rjtUBBp5Dl9FNt3ku9TiHA95vJVU81sXRmVuUDyvmFdC+DKYaWAqowuv0V8KSJMvklLKjcBguuYAihFn5ILtF4xhSOIS7nRIjwZLTex5F6KSLe8mj8onaqMs0sAA6inwhJ0J9rBCPaeZ+dulolM/G6WTFnpYHaqh3qXYOCv7yCRUo02EyHpk05vXvAssp1SAr4WToZOV0tx+slaQB3obkUR/AgPEWEul7QmLRJeUjlxIUkR17FUCGiFTjmJ2mTCUREVHdPqueawQgseM5Rc6oJwvYUTn7fgV12xkDfjl1Tf4RTazEXaG0lqA5mkKWUtk6htugKpokEzC1z6CkI0KAhtMRSU1ii3sSEAsUNWms0m44v5C3A1q9L56spZ9KQFYvjmqekBPb/dAHpxDE8roJHCuTPkS0L/8xoaZvALrrx4VpLLAjtCzIHnIIjjqiabOIk4O2mExrQLYbJ31o16rOwh0BSq+RiKwcYvtMqos7C7EzioVxKU6xpEJ6xqIcQHMtWmYZiqJmEduYDYR3EiTf7gnDboESd1OzSR9qfFv1WAhd9s/n3sJ4SKcGRIYJVhYt6Cno/sA4QWCCgE3rkvzyv3oozDsoBYMktEQYSQ9ThKQCNVIc02aOLlTUUAx8YG1YS3Onq3o4/ykVo4A3FVtEk97s1zw3gW9jCXh+hec0Q/3/Ha6dIJecyFIZwxVTPxn6ZkkcwawOLa3YLmJ5aa0L7GK104f8E1LOlbdanph26QebARLT6CC5uF0AqRCM2XgyihJWS8sTyoizVEcZ1DxNv6OI5OaYaud0wFUOd4/MOUTpYKGSSv+iVP+mnH1muWdq1W0hZGyD9EWYzLoVNllk1zAkTR9HGW5rRlra+DE+DGIbNYM9W9JM+ELwOpy7yweM/M8r2HZVFsT7JW109hCa1anuDE2m2JgtO8bpQUVmhvyEXRqQp/DA6iX96FJla2GTHBYdKSy5ifEasEXaxO6zVaRqusVLM5ZkPzYJegHYVNwktJ0vDktSXJtWjgtscI9UXPlLNdgXEx4AyLfEprnWPGUf8LtGw4foBXGB7L8LLUgk6cqd860gmiz7HLSY1LAiUBHHECVukWK2+uRMXC3wUFLT719KUXwMtRl2+P74MQN598OilgcvFGpCrDFO0xZsXWhB3Fmfbt26td5vn4kjFGdLjeK/erCJsn7OvFSwH5UUQA8VK+BiYq+TkYRGi2yY8I6JYEMj2oL9bo64UapKXOQdogfqydUld3+QXHkmmtmiy3XPUp1XJzPmmchDWtmtVIi1XWw/Vhq+LXXJWI/na5Xa0ZmpEbKm1yox6va0hRwVlhHVUknwu/dSp5hZ0MMW24UkAsKrj16mo5R7taDHwwBBT2txAqdRwezyCEhak5vvcrol32wfN97GcxdpJtnF2W5tvHW2UsnYc+pjk4xYPXchzHiJOhrTHm2MUePtyZMIbyXovnGguuhbOjGzZpwTTqK0jtwRn7LMQ2Ls2dWbXTyrMuGgqpRmVUSOKK1c7gzEfXEAUWKHtZK/Bd/CU6YsozeFoTMBlEsYNsW6vKCuYYMF7hx7FyOMIN0Tkn1jK8e3DA1cTrCEWAxOe39F7lpkvkwHSngW90y5PVII2dMGmD5rM11ZYi36sQ77Megzet0zwToUvOz1+2cQATBw2+e8uHsVLi2jib8WHTLsCHUcOJY6ffSMSVdwDpBfDNXpuBO+5zzNht23gxGMJAfN3Gtx772YxcFsnj5T12y441qgt9EPuyVCQWjZyYslmKY1ibNkQwLK8C/p253w73QLAbtCKIYxZN9IqkvapRSXe4VxcuZrJq0kvc8fx+p5mYIdJP4qWjuLiACKpg3khcSZ2WpqeHc2B2v3DBHLzUxFbtKEXxUIQ3fcsXJARPHCRPOPIv1s1/5okJ2DFLLDfF8vTjt65/8/nn//3FFX4RZrz1yujVN/SbB2hxp6IVVp1jVVadm2ojj2Fi5lehrFJQORWZZk8QXZU10ZExp8awGd5UK9vgbS689SsS/PldUbypvFS6Qcr/XeT85fcZ8IWIuJyAo4zbD93CXQQVNlpMMqKUID2m+Mx9lPiUtkp85+5IfKoLYHlLx8fUK9iEUg8PquUXKmfQMBshzNFHpA6+n9T6Yz+5AC0BdRQJrC1T32iEslRjL4mCDdooNLtgufpYuJacoEwaaK5d7ofkeGYOLRUDcW3wE+E34so4WXi2BmagLT2gszRfV0YnYLjPbHhZ2q/sMKRW6KqQqwlhChn/tDiWh2ird/OcBMM3rX5Lun7Y2GzMEv6kot94RD0iKmZKmVc1U7gY5UjC5ivfuWk8sTT/woD9oz8HkFZ7oYRTZXj1ASxjuzAwidEBopAlwhYGdr4Fi2Rp1U5z4BleR18YiEKt6p3JJSNHDArXf1AeJYejgpY1DbwguglPHjXK2JuOSmnsQayV48pCKtxcEhdrzDFMKHuTjnYfC9nVtE7FS8e9akkUn9QWJXH+AX16FgMOG2YbN7bFVnDIS2j60daHcGzH/n88e+rxJrfZfrtv6+CidIvgg2Etfxp3B8E7KejPXdyh0AejwVoYqF69j1+RW9D5MRdHJFR4FywsFwFbXnQVdu5/5B2yNa1ChbVMUdOWgfTQWH1Hnz5ZGKwoB6Rc06oWwkvsFZG16K1NV8nqCwrfViWrDCMaXyf09OdvPBqohstvIZnv4IrvNiueqfHrxupRpRrLLIbWAoKOfafBqFgQAQkfbRlQrD43YXMzWWKtH4UJXrFUhOd/+oVaDtZM2QmmaV7d1OBFMGPeFinATL5WUgDML/5Nh9KuK2qX/cpA8mZiJdTQlI9arYHxfzLQocxnbPMRq7ILuVvW4ujy+7eff3905cbun56V18rla4f5GQ5feCFpVux50Uqvq5ZeSgqsugNgzwjN5cemiqeQeo25/FRPdosjCj4IJl9/SkaffjTaevf2m3/Ap8GFOnQOs3vznd2bv4czgcVvAxbJruS++NaS677+3pJpvWoYGH7CdCG6pKbs7Ibb8XvF14yVL631AaXXj/P8+Q/W+BYG+w8MlXnJ/+CINH5ri+ApIILof6CqWkPglDeS0QdXxq9/YtJSsgnfij75WmgKific4cqrksSvrw0KzxUrKkY1Rf0dyR4UsuyFVfp2nMEY8T5oCmfA25UbO1ffn8KbWYiZxFY1YwW9Fa9QS33T1FAUlA32Bujuy1Ka5/8TlqKRQ+6tpGsV2jfQXYTpArht4DXuF/vRq4I9zr1q0Qfwi3YqYVurgCA8flAZ26IBxj/9bp3+V7Y7AqGWfZuGFJNujTaH+y4wV6X5+Cm7No0McRBnl8WchN3y293+aufLbf2tliXv1NyjbERyehpBRob62yPkb0bsvOhUmq3gN+9odx42X5vj/zOgvF0HSt9KBC2ZL1WL6oxHX1N5KtiXmRxwxKOtfxtdvlaeBieaogsV8Hze8qJXgs5pNYZKADbb6MvXgDj9KW71bDhfXgYsvqXn1sJ4T6+DTPOh+8yLI9CirqxMMkvKEJVNT9HYFO/OmrdmC/dl8bhRUi/834fdlWoJ3WElvP9bQd2t/Q5plsZO0NibHb8r0eIDAb/bglhEvCDm91xr0/f2ztX/2L3xKS9afs+izBP9f1uyVKXcsqbeQXL41ls+/b4X4d0ppJqyK4tCqGCbmf7CDYHyLtTf8t8NL0akZH54NIVwLClGS+ugFAn7H+aoSf6nvS9tiuPKEu3P+hVpxvFCijYq7fb4WXZ02z0R87r7taM94/ngcIgCSlK9ZhsKbOsxiigkAcVSgCSEFkASkpDQBtosoNgi5v0TuzKr+KS/8M5y782bmTezslgku5uMbovK5S7nnnv2e06msxmH/6kzOV+ef1qef+VcGwYhTdx132v7VJ0dfrOS+/rzNyv9b1Zu8Njt3h4+0AwU1i7cf7MywSebrS/gFRAd7VzvRk8eHsKT+kQ73rxVKE1nE+XuIdBznKnzG315ePYHbJFov2yODymfw8Q+7kR5cv7JqqH6Jq1yS9U2gxbr4ipyeDSzqBPkaGjRznHjT/d0NfxQ2b00x2xHsl6tSBCo+lAagDy0tte2taY9mYy0/Ds1n6pD2QrUGCYhT8eXZgdNCxMwqDR3YF6fptQPVroj1ZyRuZNOJdvgfjAhETSRRgWdctTBOPEUf33rDzUW/YXGH809etZs+vAeIPQaO0Qz+3x6hXNtrXSvoJRhTlgVrqv6hX+Y5GGeJP6nFs1Ahul69YGAC5MvgyNTsyt/1+B5OcR3aTpZ4GmEaLM/jHtfOMEJMn+XBPkIDQusgKpCtgoQGC/JU6e+eOTama8Kh7zcj/c3tLacTJ/qbJfOcS84azBfxMBtX64Bk6gp5D3/m9XKYJvyCxihHSDqoVA3mPSR7Qehzxk2kMZdH61yXl7W/d57bWa7/tZnohsBzbMQhF5LlbFza+SPDVQWtJjyi4JBIxKqdj/ihYk3XrCYVDllUTXpjT7z/geGV8ib7pubfnTFvcQhId+73sMs7lXf1Iok9q9CdTaD7wRr1uhtUQbhYGNn/Rs6WhQTxFszo+8cWmwRK7ZZqhXmEyHctafIU1Xjd/8EV7uidOt037Hv5TcPUtPszXOPN3MR7gRywHuREYS+uMCAwyRIclyXAtMc7QsvUJzxZ/adm3piHn2+BoB0uQdJgthh8Al5vUL2wM3SaK9wOhQGYRH8uKD5N+re97k4LM4BeOxInd8cJH0bQcSq7Exi25XBi8SIGMO9VMnUFHDABKDwU/a+2fMAAA8E2QTGX6XrMvg9eXO0j4P5GX0OHeGkls4c8dOUeREmYEhS/Q1/8W3QrBfmgsErmI7R74jx08BAIA0GIfI9pIagZ6RPtSSBgovHEWLjJvRUJmSiaYP06Az12XM3lOetNDcNaGFfvLZpVRVm/N573oQEMqTT73jKpDjCQd+dTBP9IqOuG8h4m0N+v9TpQ/prrAodYRUsk2pO17c2NUpfsq/9TxKnD/ka8ykkp9qBtqPScdhqbvwYf9U2tDZlQOX6oUn7eTiYf9QHCj5pp2ViCGDYJ8n2jnRDU8qAloT3ATnehMCIX7WYb+u4zG1meCkkbW4D5kXUb4B+UyFprqWy3B6y2mqPBDszbUs/jKvT97R2Th/22TYpz68HAaQO7oPeWVj5wyEkQypDGCzL8Wssp3vzXhjVJl0dNInz2tiNwox7hYk17lXJheVe0YqlX7YJqot+0ca9zBDEy6grhsHCQGXcK6TzruByBNykYXmllXlCuC2je1BxtmYkeAsrbFZ43KuCiqP1WUHZcS+h9uiRtGGXhjQSVO9Ff8FqkOcbFbr89eeWzH8a2YZPOfKsSzydyL0C2pH2qGrMZ8zSfV07gfY6UmoESygsbwkvK6hW7mWkQByRrKtYclJBfNoUDWKVa2dWwif6uFdXkCl8FrIWn4QN3ZtYvxlomDQsu4zM3TZnNTN6oKVGvw35sMUijSu6eEzIQUFGb8w8Zfd5R4D6alRXilyNHdGNNIbJJwxPFwT8z1nr68+h0UD+dK3JsLXalmkhM6Fkq1uemUf2wlNk7d+lGt3pyjvvfML9D4ur17d3tirOyJ2uurXF+cLDphD50RARhUfwPg7br/5teSi0coX97IYz+choBg/ZrUYqAxqVgIbK0mJWqbRBmjwqruqk61xo5PCJxTxEPqFaF6JTuzRODIp1GzphEKrBa4MjZYbe9pd2MHu3DscgTYYYOaEOYBUR6kuQymCcmqEd+Y2o7kIIWOnDKvSGcADRCCowaL4qs2m+qmfWfHnwhFOGv69DMmAG819B22DgQIknL2tA7/jATdEqsSVCDOAraoHw4olEgz9SGOArYhSRtMhvRKr4kbFWiLATVC4Y4msUTVYNXuuWbsxpSVZ0xbI27o21J+qGQdzkRCo/6LUn1rwO2m88wxKH43X/fHSCd2/CANWA16cflpo95GM9AiAsu3rIpypewJ9OwJ8f3fv9t9FU0rzpvaTS97CS56OLcmIfP+7uns8oGQKWwVNWw4+tAGHw92MOgJGNVnB7iNEb6goZbYse4yIgZGh4SJeWFNd3HKrNam9tAsgkm1LtHTWh9gBWqtWsPRirN55uAVEbZJTWkxbf+ExPyLu/OZXJoENCVe/wsXu0gqyu2veel1/N1OizU1KAe9QGd2DwHEv51X2xq/wCldjOWO9Kj5Hu0pOpMNphupUA1n1SH8Q5jhbhB17EIlzEdgKo6BsVjMb7JU2pDcTXDLqbJFYamzLjmng1wpXEAzNgWVcNnb+qgWWkHhFX6N0GLnJjjq3voBh0/O7TLvdtKT2IDMHe8PZ6HzK7qOxBZBW9jmCgfHCU3YbTL+gH3OGG9xC7F8kNQfOZzvo21Kix+laNZgju8jS8H+95JDsjBGRjaehaEPzT6cbGVAvsovZOf7mtT7xDFaGnH/ligwwHuSKmgfkVgpb+T32z4SU32PHb/G9isQq/quxjkZ6f7qFMlYycjIxtcSyMztO79uRseX7ZHhlXu5gcbW3K2tiV2hnilQojWyk/wVIjq4JISQRWL8n9rBBZPXEDs3wmEF/e74CBRDmIQmP+2qiaqFRrDtcYXUkYoFNczPMhl+DhH9wnoGJE98G7yXC8BhDOuXrbeXmFF1nvM4iNCEruLnB/6wsu1sUPVAMC+F4x8S4cP88ogA0BnFC3thRN6x6mrDG4KdGTMGZP3ORzg4bAiTCB3SDsmnR7eXhaFQD2Ne6CLOyEMV7eeGP9TXOeNDpraWiEg+OPd6k/De+I0LHjehhZRJNfJs8Ex9PGKbHjZnqB17UMmoFOKCb9eJcnRD0oRMoT1t648eB7QK/pJfjX+9DDS1yLvX9NYxIPH8nI9juDDxn9xblhP+vZPLVAWsEdyAPNAW5lpA4m7igjk9oAgqC9hMWExj4qa5YC+QqXBfnyH681vBIyeg6yMLUZRR/crgxqsdHRLI+Veo70hp1h5C9CrTz+g78hKj6eT1JHgUPeCRwQDrUmYNStOjQc+pYxYXVUqqbQrkTVONCio+xDFfuTWXcjDS0IKWDN2tGjaJsUavecQsnskDEvXVAy52tT1pKAFORKP+IooE+c+zQGYWqmgvO16JHxEiU+uuY873Oyy35yxFXqfXPiuA9ZZs33ECX5412Bo4dHUUj3A1QMoPRqvjw3bT5SKKKvqAi2J3M1J58O2gdR/iaTszcDNduzz1qlJ2PcUV0E1Y+euChqZ543l7iLPWl50iX+tL8ImXKNe1Km72LgrGIV04teV+9x76gJsjzMsn/U9CocBQ9fYF+mWrnCxcVHnCNs8yss6iaaIaBXUYwDhoUXXJ+xGhiYcvOGgaKGnUCiYGn4lI2S6hZVICYdHOu5zZKM3rRJ09GOKZt9HZs4Eus7SW90TOnnnw1cwGzUDzCBuHIYkft0yykg262dhswSpw+LiENn7DVAzBRuFtmsKfNBTPhGiXSVhbqAzOYbkvkbLewwhEzxVWFdDd+EuG5NNivfSGParrRG/bzRb8DSXo1wB0bIkK5Iat8bV/os42yUWMpfAhVq+tQezdmjQ6ARO0/W3qwMOf13S7PDxcVhDuAtv1qCdujFKscdJicZfVBdvjywv0Q8NEsDfJkPfXhyZrxrXPTIKzuJiL09gIi+xA8xcbG47KZu4g+lGQnZ/M4jotFt2vWel0C+FwdXw0OSG1qbREgCFeeICEg2WYYPBSzDRmiU1685L6adyX6UFYm/lm5c4MA1JzeuA/Xn7LmvPze2IdxNI4+ca/OaD4pPbg8VF/Olp/3FgnBRloafkTSKn7xZmSjPL9g9uWCWDiQwufFgvg17uVB6POgbl3EtjbEuXREpRCIiWyLjIirFQ1QbBxEeshgnn43ZzR+2nYJthOyZ8MgEY6CAYXdU0no3Le0I9FgcBnnX7itss8Aj887/EhlN+DmLECxSSYjeNY/x6ow7yWQCFCSutEOZs/kTqi2BtAYasR8M2kPjb0vUkRUMfonYZ1aJ+TJinyq48K6xz6Cv7yAKCvVw7ubG9R5JouIKOXqCc25HtfD2JZw4hsot2w+cyWx5/aKw/G2v/UBv2ugp3XpuHlXxxWQpEBlITXaCME+i0Sggyq35msAqkMe7PGUr/Guaam7rOAMgvnHOuXqbx8FpUkCGCpxIbm3qbKa8wUHCZMAsFQU3NeMURt+sjIhCAKbDLw0pLK+ryjNUeUShi6qpUVmPsFhIgzxcSQ6mllVZhL16tcZ9ZzGDKj5sbqMH/sIacEurkRE6qPCzEjQlvXKj+TxZ1efIQsLMDUkagre63CWdfOI8kbb4D/yr9wkVd7Q4Xvk4zYTN8EBPK7SbG4WmY7WIWdLitChN53Ha/CK0vQj03rg7vHH9IZBkwHBn8tFG34AztrYDSG4YL1ZjwCFDzyFPT7SnmpNpFPAimNlmMeLbCNO5gQ98YkgxH/BcKWoZHWJmDAX2xvm6tTbcOhvfega8lWwBFTMFhCmIetaAwMNwvVHF0fKnsmokzxC9l9UE0ZqFMZlcXg+Uip9oHvo153fHy6BHVZELwcwJveG5xli50OgwX768kDgxUzWIyAqCvtgxLKghPuTTBv4iEN4KBOaCD/q2CkSXGHRYYui1VFrULyvFChbs0pe/BoQCPXWgc2umNDnIeaYI08rzCyJaRc9yHzwEuA1yFEX0BWUokIil4fpqeXqWR+MTmYLo488AHY4z33jLFMrsnFpmSVGHz5exL1bsIWJIoGDGlyiyemYgK2a4WFH7PoYu+319iIVuTLM+cFxLLMBDeAoL1+GPZ9rx2hNvofpEeEWPysVUMOEyFY75I8La/dv6LTzA7Blecv2WN6Vxm/36N1lltr+lkBXWkbc5ZKXa0AZzTuidDm3QbAQ7FMLyZfrUqTPoo4wFCrJ0VA+KYBHk8PiG0ccqiGKLsS1/l4Ed0VM2m403F630CwrRMlqjut6jJHP7uULbCZHtNvwwszFDFGL0oyF77h77HKXLkkhNfDOXwSQVI3tUSN+3jQYsYwopLXMUH2r25I86YvJ7GEAmdSC3NKPRIB2eSUppQ24hWLPVgkzM4rVafC3OR5USS8kKfehpp5tbTS8VarH2poZys2fIOXB6Zbc2/R9hTkolcqf5bUSiKK8cYUhwoGUI+CjcDO61IvhKxUeYEELsWKG5Q2K6oi1L0c+wsanq8WS7wdpHI/PRX2i5HKqbT+hhZ9NZaqOx3HQKxHNyz0hquD4VCzPiNPAmKUw8+qJLDzrnNhwViLI7E8UIqXHtXh764S+S3J5qBq2l8SsUdPYGK0J/oGrBKsOsr/3Asnjt3VrlLxU5UI3VWy+mjvVmA0ZGtMPx7q7SqsiDKj1ftm8ObsGYaPKVScKAJKXGRFpx0ERWQ43TQTolv/lWmr/D6XK4L6paM7RHrIxj4NUIWYWWldgWzxat06AqV1rRKzmPHVlsLadNPNqP84pDKbe4llGA4YDhyvAwjozWRa83b3zLYFkIAY/EadZXUz+kGjrDXeJ4feZWRw5952Nfs9+nO06fBhqMRpHQj6hpt1pzxHv+5tsxbUFLKiQcVms9UJ858oOP3UrVxvf8dlH9evcJ4CKmRnavyKlXjRV8xcENvjaJIaqbWHhi7ioetqieqsMZ2aWvxnnY1SU5PRkdcZzI/U+2tzafCD4IzZOI13ZmV+zaxPIDpIqF/vIcWdSvXK9m+8ZeezTc998trbwqLg7Afyvt3s0tO3YyOIuZbcaf6QV1KmN0jR62Yjw/h1eFPIihidEsZKmPyvPLIcRo+x2bIXJ7afIWCChspHD6l5wn05uX26tMUlzRsmBMT+y1MFzv4aFjBqS+XvteHxoZSP0wHrQhaT8kbT9n7eeUoLLgmi+V/zs4nVNczCojUrDnuGd0DCGrTV71jREgaBoy+LCPhmaXM6dJrJQckbqGSTpXnplTJH7S2PhpuIHNlOjQGMi7qdHp1sLw0Zn0cJ+karAmmuTVtzEbGW6yffP5YitzCaabrKyx1ws8kH44+m3UzumJClIKqNqbDBcT+2U3aCyUL+4GjVm/iqAxt73+B+XpISEexWlTSZIxLBUUlF5F26fT6B4/s9VQN3Y7/QNFu71VY4X1nmcrR+jPlQPjDkZl0a6Y3jVOatfNpHU1i22wiKCuNqWSGT7ZRCzGo9pFZDuNUuUZUe3hWyyJK0wOh0zFzKuu9kep82QwS6WcunEy6sbLpxu7JANesY0e1H/s0gx4icAfFW9Z8QNNh6/4LpdncHl15S+YKvA3xEIqf+Kr34Bfbq54A14RBRzoccTT6HVhTq0H6UehWUX8jZAwQrMG/5LU7ljxxG5m3ziRRR69rXe5tHzZe5bSUABqky42mUepWBi0+z1lIYLaNRfFk8q1G6YQM/sjubr0HkSxY19uUq0P37ooVUDT6H2qgFeZ939PcQLux9VXm+LmKxaZCj9lH7fIFHVUMRBgx4pLhWWVj1NcykUuAS6RXyy0tJRnzXagZFFYc6HiCKfYZhz1C4A82D9IJ78qzCOn8XvMix8i8VU4rLfpg/J4fAur1MoxnOQKtydQaENq8plV99375mdn69AOKmTonnxpdS7EDho1+i7XrsarGLSr7daEskRJXIKKVMXjVIRyN1H021LcEBhaVaEofa3+nutE6QZgVRPqXSDqzhWJ8iLYr6dEVGgdmZhEUBxi1iwcnObDTMCVYePESWKxKmhLs2Lw9101VhhJNDUsrBpas0YgmOO6Ov11qQ4Za01IwIRAQowEQ2lbM7IQjfgVWYrmk6Z0KE6oox/cDjP1Wve3KAoTUQAlRPQRDUhZxw1uPGi1/YARjmdqD4Ztjwid2DNOXFnfavnGHWamwbVqSofgdwiCdxrPvn8iajWEYXmYxCViXPXPGjrbM63ttW2taRTYQLKm01CsJ3AyUPSVESaXf7zg3F4B5s2tRCJMc6q5HqQCxhf+EY0ubYwV/Or+zkyq/YSvdhFGWkYZqPlTslB7W9l39s3KjXr5wv56WsJ29budfpPX5pK62daUbAFedeK7hlAZLMJqHVaFxruv3yJw9AWsBKni8ipQKwWJzOlkO2O9vPOfncmm9Mk0WfTxQThV09Zlf30ykw6c1N8kJAPFSvRHsYr3xPd4g15QXJ+yn15jSd5ef1zqebCNZZP1Sjz2yABL39zLZmJTlW1guzxX80vl59NbsQG7URiMCWEE+DNLw0v8UCAlFS0NzXQMAyDJZX890t40+fhaGvfupZ9cB4j/REMrjoJCJukOIvxn+zvSqP1iH865J+UfR4rLy/bAdM3Wrecs86BXYeSuvXZhJ7x9kT45jg2FTcfAl8eCP5NVoGTxJ9c9+eMgGoR20l0GfSKhje/YAbm0s6ljUyGotJFK/Tnyo20a9qGERjyPwVK/o5n4leUKfBSabmhtTOntkp5l1YNK9TcMsmnM1HwqHGtU+ocbxY9CWwyr04hX11/qKeG4KDlIGJVuaevsyOxjRvUNqY185unbCmUILa0QIUlN0UZgfsc6bnVR61HW5AqVN8M4rylsQHsSvshVh28T5Xauvt64+iqI4a6fXHOKvx2jsV7NrWqzMZ/J6h4qv7rLm9dwZmOLbFDrwpnMgbJkTxTsuRvc3WY4oTjXlfw+Ca8hgf8mkIRhs8l/SC6m1Cg5kJZ2Ko6D+J/SOehWW6o93RpyBKFSaEdxfa48d0fFU6QFwQg75bQt9J7XEzWI5zPwd3FtysnPmU+UNHZ2nIluTI9GisU8XH2sauax8AL62RjL4iJT1Cny8bmbeBz1rcQFtCXTjeFxARQ0m2qKeKMl1XFCtrH96xsFubUeABJCa+GFPdfvDF96OwBrBUbVkaQEtOFQ8Zxpebtg2c5QiiojJ2LGS2gBqebszXy0lGFIhkIirb5AhihGz/jgofR0wjt8ZBX9vb+UWI9I8cYDP6RzCL3IL6wAbCs56IWyxK+LH5W+YW7Cn/Dflb7QwxD470pf4HQ/VgQ++u3IIIPNhciU11ftgdvM+jaNZr+S2IEYwhvvN0GXd0Z448TXfPpvC2IbkxkSV6uX3XySmlngUOJVpfOYCCyRfeMtSh2Tj9yV+gWIHDschegKeQOvnWx3ENB7BQ/E2xQ8SEXARsad1zkGFRsy1BFXg1b1DoId9QG/Q57dljwjUn11We7GqoJzi9y+f4+c2yfd0ILpQk4ovDbFj3SM5c29y5XulgrrxcVBxiiOAdwh3sQaHKbQJ51uC+xJ7Kid4E1mK3jV9Iw5iV0YY3XsnWix6rDDFtTYt66q4enPJ2vSVLEzpp321MlUe6ol6pSOsO1+l26k93bGUBMFhsIgoAosizjYKiya2w8P49mhcDPu5o4v8ST0zmKcSvIfPgKhg+I6QPDofeE8vUsiR8RZ321fsZiktxLtdSazpeUcG9KAGArf48KcvXJuGwmvMNd5+2JvJ/e1GfKrWbG325i7s4fyXGPu9iJ2ZR+g638VcQfkA9QjAgiPPee56GvWmit49z3W5Le3EzwamuZBj6WhSR/5iQqq2o5Znl0i690RsdpuTJ+UzCNWyh+SA2K1LDXAqkWNdyFb7NrAf5E2cHfPLD90ruSiPD5tqXZ0iqPGdYIDFd6lyv5f/6XugHC/qdOJWMmukuLepXcS71RdJSVfU1Zd9liFci8N8xVU+i0dv9Im7ppIvNzJzTTzDk4bVmE+qPLYoYiyVgvjC7HWmfYHZiu+weq+c+fx2GAu5LVos/k/wnm8EAlaGLl3xpquW9C53J/qZTMis2ZJf2d2ih2zpu+EpKMld9Bt8LGi1TQj+Q7Zuam0Vq+0dtv526WxWX+6xV3jN5l0t8fqrVsnw4f0a7N3v01D96ah9itnEoQ4bE7cdrO23rgyaHMvmzJrC3v2u+cQut16WzPqEIRitairlnGS9Yo6BXGaFgbtXZs0X7s26X8Um3Swo4hYZZAZ8Oi1L0y56oKrnqGECRpHQtITfpL0k0LfEicbMMlBGAM+DduJC9rQ6ZRkW/r3yUzqbAL+SOCIaZSZxPtdMPLWxtS///VfP29tbgN60dIhDrRkmjpP7TubgCkmxPnGhIjNT3xGdpOO4w2Z79731Dar+x9uIvnjxrbV2/v4uH6N/5ilHw/s+RW7r+DLKm99/tXXXmglktsKvo5k+6kUiDkn6puSLX/zP21H9trSShSrPXiiaEdh7wP4Z9sOcHEC0wfw//XVX/53FMSDRYtNPF/j+GI+3rGEsvsgVfZWCUAP8+V8cXXSQI1j0OIQSixz8isRws2LHEIgo0mxsUCjtEJ5s/yHlssI3g1QyQCN1H0V1+yB2TcrObvn/JuV/ngG/1RTR9IsNYQvC8sKaIPue1qe797eZWEOhJkd4qyCWyJFX4p4koTO7DJ4GFCmdPmU2Z09fIuF3sCbZyPyuGx1FRnVy9kes2E72QBEpKrFiinXbGHJqpFoojdRtNiyjfvGI1l45QrD+fcQLh7nyDutJm8YUKWEBXTiFaBXyCE9vzABGG7IbmxWujxEGHTxdkosbzgZHaF6BXExiIixSZ1JCPf4KCNcOCK9i7kFI24FthByjnA5PqYkHyHLCxpCe9KfrDZWZtoQ+4NptJuAg7QDxpq7X/IHqZ+x1ZX9/fQS36KH0gJBds1+50rOdMR5U1OIMB7GMh9WThXquyEmFu4i+oXZ2sSwycqmdvx2GNn0xd+0kS3KkmZZNT9lx8ImHBeBAvGR/iKOAdk1eCI3oEq66qNSG79rqDVrjn83iiBP7x3of1wpF1PU/eNofgLYb0nhQ9iikmdhTJBGsatT+oDR/4mGvamy7K0tXyW/S8E98YcnRCSW5QaBfLKp9fvIHQiDZNnoP8TbX6dT33vmuZWa11RBGPY1yz9eDJGRaliQwBSzhhXDg6XC/ewvfdISj/fzPyotK2Z4qNmHYRj/wj/+ggygo70zte9/+hoBeSwV0RIFqKmm6FeFtrSC5vtlXXPxs7618Yzvo7OhwrWG7sGysZWXLmrx4iyfWkBZcz1AAaKXMO4ibtMybu9Caq2Z5HdPD9/uq3LJVfPfg9QPgocsarUfyHP6VMveuph0UWbaqQu0fzbCFqyJOFGUpOF0aybV4qMeMP1/0cHxRTrZ1HpKa1xmlOOvBSwwpZy4gdAA4o30dX+moz3dcip98sxe7eE+A6UOw2McKutv+t1KmM2dHRcj8jxpbQHxsqHjd8Lmw1IwuuM+268KOWMOQAws0L5DWRPa0srdf05t71WpNvd5X/cRd/XMtBwiYWnoQnCi5NCFkN+zMa1Wu5FujAdlIQeoD6NnrhKs7iXjhizdLH7QZlRT0nKRwqrL982wSmbOtDRYew0UJPl9Mt1hfdne2pzG1H9NTXu/EV/t3fcBzwp2WLLxz8n2v6U69u771rdbcI97oMQUQ1I92gs8tC/51n7TZPajPxXm/6VEub01NZ6OzkYu80mXvGGHIZSflp3f/ENjGm1b8YQJ/yLpxPRkEijRvkiRI0gcTmoE1DhEehpAyu3dyMZ5uXRdTGxTG0/Jc7CEZ+H/v6nqamxtyOgui1pK1NdxxvWQ7W9urK7JwHUArmNHjuC/Bz88ekj/F64jBw8dOPKbg0cPHTt28MCRwx8e+82Bg8fg/m+sA1vsN9bVmQGiYVm/+c+26PcqPf+VXv9ksbsIbZivZjf6RuyFmeLqpD3yzBlbKvXn9uzZmLpjj17EGnGFdQ7a2OjLO8OXfs4OqU/5BMjP2bx9aQjus+KnmoT7xcV7xcVHG9M/QmtvVobsxcXS2Kww561P2D0zG/fH7ecj+Ohe3pk6V5qbLo322gO3yudXi+tTpSvX7clZLFoy2Q8v2yN3f86e27Pnn7TR8xD27Km1NqZfY7wbZ4K6uFpcvufchpZv8KjsXJ+Tv/NzthurME3mYLrO1dfw017rsUcuwk9oEX+OzMMIuXUYVXEZOh2AqYlDzeKrPN4Ze1meX3AGZjbGsvLOLQQUNWXnr/BN7l3WHcjj+GGoNGsnu1x+kIMRYgTt3A35jmcMlQe81uPkLtr3LgDcioUx6M4Z6nNu971ZmWBg8tqhlzD3TB8Mn+GBOTrX5zayN/TXoMdioaD3i4CGfgduivFrLThD/eVXSzBgrNWde+xcWyvdK+DiFu4DVmCQYR+tL31u566WpzEEsTTxyhmesemgDH/u5MYVkPGoEcXJcHeMAC58FCgkEGTt8m5osDw3zXdgppx5DH6qdPkwJAas82N3aXbQ7pkFnGFMA4jx4FV2f1aqSw+WAfdwKeUAoDVEcq0dWFln4Jo9ctseKvCYseQEQRuGavfkuGWBivnpUj8s0NBG97rdky89LJSur8IewQFoa1FczPNX0JQzdX7j+mjpxgU1i9LyCMCNMQeWu/R0TW4N3y6sYmvAxKH38npfAlarPH8BoEl/Tc84V57xMvo2BC7U+HWB/ivjdu41N8kZcvk+46ZqUdwkSxF2vnrFty3suSEEQOF+aXjeXr1jT2DMGqA2EBJEnHNLdt8yW8IBkLh7Jh/xYHDZ8/2l2XU8oDeZLa7PAS3jLSK7dqcodtK9PN0nLMOfOFSeFGNoafk6jBNpnjb40vKD0vJTmG957aLY5UAax585I6PFwj24Aytpj7wsrj3Ql51hAksnisWuXnKm7/JG4QFwv7A/nNsrjJKckRJpwHgfvIx+pnHh8UNEpiFhDZX1aad7HldncVk4qJaHYVTwvn3vBpHhpzA2mIgzNSPRBJosLr9G7KhLtrVlEt+n6hOgrKfgP0Kb8wgI+zsyP9TFfVmTIvCzNys5GLd95+ablf6KTQg5Sgok8fp1+2vIZLz94VxLT4CgDQE0AZXtnh6cdPnVHXtgGjmT2C6DzmC/PZqzl4CyACAfAVzLDy7AiiE28U6mbcnghK3ItIMfEezzdm/eHnkkiMjqZaxrwxvs0hBnFnCe30bUoP2GdPbFNNA1Hom7wyXV4HawWeYH86+AnOGyr4/ZEzdddijJMaZjLowBFRbkGEa4+rDc/4L5AewV67cWsGFnat0eGmcsE4gvSTx/qAgrhooK9tatkxtFZ7HHpSkcMD/VOhIbdG0V7oT1qwJWKCbkBk+TGsdAScR6ilPHO5Rz1p6YsFduq14UNVKw9XACUbu3H+UP6l10qjEGpIByYEDHnWevoE0g7hh4MTReXF3HcHmCIU9EtoBklSfC+FRavgVyEjK2e7QvgSmee2J3Tzq3F+wVpJqComgwcV5g44iXIGD15+SmpBv9HkRlTEaS2TMDgwf0A6QFco88lQg6lnWbnNX4Ux4RD+WtCUH3JcWHsbHMYa8/dvILjELFpVtIt9Ym9C4EYtBP6I5fYGDyVwA6EfGuFXlGsK9egRccuJmb4gMGiDzM12X8KxFUT/tCHiKE16vi4reesrJB6Uhl8QHs0ISfIdjHPGpnMltev6gXDQO8prnO0vEI7iev7yfF3ryTy9vPnjvX5lEamZqB7WXViYpvdRZTXRSmxuadoe6NbL8z+JDpvMJFPsiCaE31Op3+uyBi4E8xNzLma7VfNZyAuXlwQgHOzvUWFwtKzHTGXpOoIuRxsQx0LIiAjvJ4afmCgP69cUW/uF9kpky8gA6ODqG3nSVTGjkCdfqx3XtdL46NKzQ7DC+gSELyJhMRRPq+R/bALCweCiwj8zDUjZ683ZfFhPFfoKxD3BIpz/IMt/FmZVC1gUxssaCDCvunr/kRIgNNo7cHpiGEsee3kcX2zFBq+mFFGJgq8CPBjAXVga35rDQMEm8/LWhHe7IlczLVXmepT5zBWZgGry4QY+D0qKoANx0Zl0NgOs7LDWKs3gNMD8etbSQEb0+uPLdWWp3TS50g8sC3JJzo+8deLpQeD3pHPeF2R2wDuYXcw8GWUTgd6t+4NKdTGeAUHnYY+GoD8+vcE0Rw/fFG9pYzO03kDCj1I8BwF72nHwuRRpQvEdMpvVwGyshowLoREDtnatpFV1IgYHjQxUZ2DCViwrTS0/5iYVjVakMIE+tFt5czP1ZcG8RebxVK01lRgKAeST/nj+Ub7fiGlrYAdgaIWggeGM4csK1+7hM3B7XN6AmSw8bja6XCA5AcSI4bEmCQsrjAOeDyk0AMsyyT6pXyYCl4xgAhkBNwrQg7gq8pXADqLYWQp3ZuAhZcglYQI0ldRsRRSwqyQUZAY8NNObMatvK0azCqD5UxCh1j+REETCBUMCoYp05pep4CXtAanwPY8HZEwjRwu7y6CkgA0qqXK2nvEYkcKQ+cw++XXiB5HTmHQQcDLwEgLFeAWMU35SfdpcEngOBKQmeFqjSXBRYMoCjPzQH1Azi7ai0JG3Z+xL7S63sffgKTcsaXijCAuWneTGLrdA/Y9x6iTH31ilhEagEPHnXPM5pbdT9nR73NX4Rb3Xjb2426rXeHty3gvaWVLPFeNHqgoDE9J2S3ufMkHs7DoKAtZkZMVaABxhrQWHCTTz5BcvD0Lmalh51zJVdczgOlYlGRteaEkEME3GiXeDV5FB1z8ptcL4t5Ajmv5wnJb6g6jPyUkfynLCgQPe4jCi/+KTtF/A2pu941ysmCxiMmsKEHu15Z2hi7Xp6fF2Prz8IuwDggiyGDCtLiQPnBJReVmMoQshPm3tBMLt1SNulWari0MnVzMQaSDXRk7Gb5HagJbYIR+9nF8gJstR/LCy/Lq0/EuLIPyudXEWFHL1jy1ADMEjnMX1PJho79Tcn/ewZE2K86M22plkwKeQaBVB8BYxex+l7n5qhvKAj83GNclymgixMEA5B4hnpKY89LhfvWP394+I+/t2BNyn0vrSPw52+tg/8M/7D1jCUT+hT1TIFXQNAns7wrYSJcgqbdKq8Crt2xDh/I/NR76diBDE6ctA01NVZTBBcb7LfElx7RltaVdSEAA5M5pQI7F0YAG5CnTPcqtYfbA0qkqBWjvBAllWh7nokLLxiDiKdHNIXvknUEMAIJx8QE0DLWkXGJ1nqcflD/e1l5x401hxIUvAB8BKgn3994BGiKbBeAxGoYmZfQVldcXkjwZwmu3cEyeencUrEwJ8kC9V+4guSLRgFatfX5v/0Ox83h9kuveeikF6EpgFvGn9S2esoiDv4PTVnd/DkPTxF3NE315EkyzAMnUECAzcFoiJB/NV0amoNRqjcRF7T6GGIYbG0QcuY5H0iBhDDRd668gjtsS0FsJkNsef6+c77HHh1GRkUWGN+kkLbKibhTUGzjMa8sQxU7JPOJ2sC4vvyMFSdnfgSXjO4AWd+4c8252s3gJk7mmlpdHANB/n432tL615T2jvdBFCESL5Thy2toWVy8b9W50TdErptaT51IZzKdKfULzQZ1sCNVc+X5ZZDrAAqCGvdftleyPvOvpigLPUnQ1DsXUBISQ+mWuaJyOgqSWAG04SJS9aukJ10aEqb33h57DtYjpwMF3keDgaKB+SuwJLCQQDjYSMsSuSSxOFoYvLPYA1TH+ve//sliU0Vx8RWaIUfOOVeeEUlYQDtSbtzueblx9SlQ6tKjq8yFBGEQ83Z37tIUry8aQ0EaVqsMaAUS1OR8ef6pf4kBma1jRw60/QB3Z4qLg0IfWH0i7Z83eI6ITwS0BFoQRxYSTu6R8/QOgwd3t8YEeGDcC4pW00NACxmxgbWLfgGisHQAradXUSjNCRkSqDDoPuUHvfYEKsw8k9LjeQLnLH+rjLL8Mo8U5gbyorOwUFx6LpqaXynnkCQ6uYvKZAOAAAEVCaPctr6nvIvZPKgwjhmqvsel0dr1Hrjb33UjiMbVI9ks/qzU7Dnd/sXsF7MCkAGb1EZcTkXASUoQjQB6fv05I7GmktcnUNz+g4Ump9HHACudMuS7GXO4Q2WWZnjzIjCYyRT5ZxXP8G/J+qYUyFOVsWion00vG9lRtAAIm7nAHn1z6b4DpY0zB8AJCcGDoHO/tzQxHmYYI+eOK5AIBxppGyBssKTDEmV5fkZMFPGAvWB+rMVjKZpVzMVLjeo5s4/s0YvO8g14ZH30U/bywYOAz6Qz0qhZv0Nfmc69SG7zrgWbmxShZqqv7zD0RhBEkDUDt+9fAkrvXJmg3a1ZRRP2xJ2Na7cwFdDkLSQxBdRRBRcJoeNAWQAmOo1ApRvJFNNO5ZFQ5BP/MK0kYwEQeTJ3uPiM1YQlO4BulfW+uDwsDR3ogGL7DG8ZIQc8LPAj9Yk9vCx2H80X93VuHHfHYs/G9XulpxOkOJGpnyGhvDRaCzrE5A5FZFHeIf1lnyrlmReZ7QBa+CaJ/8ITwWeAhK/MpTzYmvYa/FTvIMdfeAmKAa9MglEaWSk5P1wKOAp8N8sogHIJGw7RuokLJwQ+4hw+DCNDO7KK+93I9Bgz13s2ppeFGjR8y564TWaskYv24nmWUdTaq4LQbo1rNqII5yUtL1pQX84SrRJvexTeeUDEKZBPWQGxhwpo+aSBoFQ1viR1edGmXoba7RUBNb+A+nnumc/dzK+isIQWf5yE6HjJtcMAzI1fod5OIopgJaNDpefLxfU5ACdpPHPA4dm3XFopgMrCQheDLsGqf2Lj+oXi8msiPYIws/mCvxBAy42rPcQqNkttbFDlD8uvB0pXhgR4JayECbBnoQiCC60VQgJ9Inm0foIGOzDAwITZlLqfCeHj9jS0T5h+Hd8cW7PnVskPRhrv3EMECQgrc0PFQq+dfwXvgN7FjMseuQZDRXS+NbPRfdleABhki0s5suEs25cfbfQB2s14lQkiZv2Ct7iyGdJMGKCdv11czZee3Efpa+EF9LyHxW1Fj8prl9FSPd0Lu4pNMUAkrLqj/+/qR3VSAayz75+z6I7rrZ0cLP+44EzN2OcxZV9peQTaxillPd4UJKNTWYas6gmdTONLLBkrFEQcY7MqfYji7tqg7NeHz0zX1adcaxKESwSBt5mfsq4ZH7DCpaYykgPQTbFDFJpWRhB288gjEYtI0FTUF9RmdOevnLMXF8ULguaRdZO5zeiQc3uB6ZkXeSZ4nGIDLqMxEnkeoQoTCQG5uZvOj4NIOR56zBFidRbHuB3+BFFr+rFYLyUaW3UHDxwAoQF25mgO0Nz675kjHxw4cGD/gQMIWIbXyDVYW+lt0vGJzeyET2hJ84ldjFvlO49JSXrGQjQqaqsjrkOR2bG7YOwrGJsVNo+eWft5lizNohBlZ+ZMnSUM2nX0CwHKHZBy7yro3fbiOXuyoCwgsMFZ3Ue8BzFoYEChBFn6s4Cn+g4tDT9DAWHkkbDpyjEiL114zoNKfpduOVUnvHdkFHGnyvNn6HM3OFSyhJYmbzlP7yqDvtMvrKX2+vXSnSHByNavs/BB1GEJ97xGMpTsqoG7AHiQYNxk4kS+AtR9WHhT+wpNmxpqOIP3HZTOvVxpTHAlTphGPMf689dfosJFYphFgq1r22SaiURJ+0KzcBI9nFjnyAkytWHICIeqIGNizfveA3u4h3axFJyZqSvTGjIPXe4RqtVovvQAAxq4c2iJ3CPiJLhSxVEyfH5OKeToFyXjiNSg0NCrG9CZmeF/166yCoEtICtCMoNCyWRWqf3K1ML6P/dYAjIwdwP39GIWIw9AQsgLeypq3bAJCwWBB7lR5+ak9VPvJXe6yHFppGhZojQ10DO+4cpnGHtDrjoRgpUTSrwlICE8IP3s0kIMBJLXM4Oo9WTMSv1ANjpLeXOFz5W3/MIL2SktwqDwBXHL7G1BtvT6JVJ7GiegGxAKGR80xJ/b956XX80wrwckJyY3r2RvkDCAvJbnr+h96TiEXZDJxRU1dE7O5l/k3rQQbHeGPtD3wd+z5R4Q7faClCGGQV9gtLXqPk9mTv8eo8OBsoCwBiAsr3eDVmEdOHDoGEAOdotV1wAv1crg/ESd9bsv/xW3IL2Ifjdqi74e4v3qXH3gXHlGfgcPyVT+ApLOy9keAAoIMfqEyWIqEZ7kSY5JcmMqEMbLGGIV/JgVUN/20PW3qncCdYEuOFoEFAnWenhYgtsSSePXcMSXlBYu5oByC8XJ4cr3AI6M+0zuOKqlWyzhKEHPBQE56/VOQbzBuYv9lieiixKRvZIFOQr23sYdkMtRqNx4+NKeuImfTGaR3UvxzIfmnFANt7SaBWGoMhtwpzwLoeUJs64LIpwpsQaYCy8QGvTojoDh0mv2sHALKEeJ9Z5QkxVxfkTm1Auo+hJwoDUFH33RmVvqkTkskLFqjXNhX4OIvXG7E0glBSSs1e7SHqJxLP8EXuP7PC9X91L75kOLdVp0+X+XTn1P58DJjMi/T7S0dqTq1EIAlXSmbqEBG3Y5miHbWjMpNEJ6pVdhDWdDgojGWBxmLZIFfl+kkieagxm+sEzKEAWUu3PPOK4ElE+UZQBbOZSN3ySvv4gzQFZNNkOOr5ESAYkg94Er8xZR3mtlsxYjprPc2Kk04CKmSN3fNzAMTSMBED140sbAk3TpoFAWXEFgigz/SIKET1gj2EpLw71g8qijgdMQjuJGngBpFBEcCTwdBaIPkEc2uMgtj6CnOI/W9kZQC2hp0Lk3ddNHFNQmYQoCTYCk6AznioUctyJUddEC+vphqtIogU5faCQhbBxDBeE4unjNhDPstleYIzVbEs8AtOeWDGjDLymPCIu/HNjAHiIRgaWtGjDm4Doyt/OFW/Cbvpvy5UeAgbw++uKIT8wua2Koq1d43fhN00rKMCVWw5isyggmPGWqFELGK2GzyPXhEVTlmOfOE76gDaGksbl5cRADF56iKU9IOxRnC7LrfDdZLVt/aEq3dMD+v3EYjWQo3g7McoCldcAqP71vXxyAP3R/aF1HpsGqrW1p/UNzmr7UP2KySsapy3bhMguVwLRbmynxYgJPgaV+6KDYSIsk96b0yVTDmQa0mGIc9s1B7ouM8084pB/EO7vnpei9HV2bte2tnR2pdqu+M90E2F0au1UsPHBuXsAIBDEC0NYflPof2kM99uhjYxw8x7apoF1X61xGG4Xz4wiaja7POnezzi2Myzl4hK25i8PW4X/Gv+ypPrSdsYWzcIekuglvP91sgJUmrW4RT6eifjlwlt2WSvWa6qNUt9KTUetGgaqxOLPTzuAtobkNk5sV0JXjK7X4TaGWEyNC/VUEZrqmPVNA6EREvDrHGEQErsM+RzyiuG6EDzC9+SW7MIae5KECwmqph2xaIhbSnSCZRNQEFemGdoqreRVVU1waJLPBkIrpUxxIh5voVOMLvGSlRxcwXs+7amoMrEa7YwjEmZGfACPMuJ6FiiHDP1T81+IwR3uVu8dUGJnaF8agLzf2VsZ9cSCdJsEhtHFBKZAkzlxYb1RzCQuTUl2roCgVqM9RDczpcOSgIi1m+TVfoJA9uIbWTYo/Qi+e1KI5UkkZbzjCCVvW4ptiTofFdXc6SqR90IuRGNSddeTAacsXFwKdH7I4dEcPsDgIituqHr/Dzkp0SNBQuVkxzRuj5asjejQKalBs4CFXpnX40OkEn26x/nvm8AE02Uyw5MjROAATPZaHdRQOKbMX7/Nm4XCeONBgOqdAgdkhOSekirfQQjEA82VuPxGXnmhLtnekG9JtdCzaEiEefZfYagMDkExBMQBoA4l+HcCsx+5/qJN2JOF+4u7hFsqP7+4q0g2cyUesJuIjXr0DlgqZ4EDXQNACMdiFF+pDjn6wDuKH/Ik3qoHcFjLEwn3/sPu+N86B2pdhGO77R7T3PYEQ+TjLpbiBgoDHj0SnQnweJ3TjK8e+5s8XvEWXdjXXEruidCe8u/MWC7ozX5lH4b4gb/D03kOYDrveXac7gpuc8ih2wPSGH9g5ePRMX2Pdta4myXBB1sOre8iyV27r7ndkGeyRof2FY5ofgXf4KduivG64iSC3ZY+kiMx4epesvIR25Al22aXmGHbt17F8wz6vt9Exzf5KfE2OV65FXh8UNyIGG4CTHxga2NS5KwEbIhioVdIiJnQkSAjnGFsZEqytJNwo79gQ1N2sLubqvtK+AqgzQV+pG8ZCISvyWExCxoUg74cBCIgSnORRNEImqWJptD7gIFV+hFDv6BBvLB4kQ1GdYQv6TlWDQd8pDphAlFD+bQy4O4jiMk81CFbpFXCd0P7JkE/S5+4UIx4dBkEfxA2gq5kOi07XobNQyDXkt2STiu4bFZ+0Jc+0tzY1WUrl1V2Z7m64eluIACKYmVr2uDT9TrUKHkcBJ9qzFd2HpGdSZ6z+kVVQ+UbCiEyQjPqcLTE8Uih6kMsnjgtKuV0MbptELG/NvHIQ+TwEPjFed7FY6Eo5jmlTLOGDM3l02J/uukyWhVosBnkUhmKhlK3lfOQAOeZ3UbRcM2Yhv3g8rwZ7FAh9Xp1fxGANFh0k9HWjvGKtbEwXMUEBCzptYfdvzc6dd0UoQnnUqyVzI8VphMVu3YiquLFZiNRnRnZn11zsmpkTbDO7NGR5DM1sZoZ9/gCRHihGgrUu3Jh4VNM1PjItc1dYmudgoD/1XpIWNZ8BlqkQn5gTnESJsdLcqh6JJsnoCiLvYf1tvgsdoVmIj6ooMyptvQk2xKJKTSZYaOCAuothKXQXGnDrmhQXx/iuG5YjLYzuXqTzRnjO4uYgSJ4aJCdnncms/WzE+uL/JFtOtQrruVXXnPxbqjl9SiQGtWprG06nGv5Wh2vHp9hQ6uQXMJiKNVRxANY1hLHI68qW0sSo7IjSxFTwGYQSyt7Cm0EdbsBJeo2HgLBsbzYY6siPIsI3z8+WVl+ULwB9fIIHI26Mle4v8zlhEZZKcjtHUVLgRffG1HVkdJN5ji+zey+Vzt9yfgSVxLXVUKt79tTV1dUDQu5p6GxvsmpPZr76k3W6o6Mt83EicSqd6dh/Kt1xurMei0+QFN7SgRWREl+m2tvPHIElPpj46FDDh43HjhypP3j0w8ONh1JHPzx2sLH+8EdHk4ePHTr64dFEe/L7RGOqran1TK0vtcb+tjNWbauV6GhuC39jT6azsdVqO9NxurXlcKV3YTZ79jCo8ATC+mMEOYVtW3WtrckEFhhCIzWDDAhY+UeMOsdt+R+pepLT0AOrm3hgJ5euDIlsDT05QTsu5+xFMvTgqbRuxMRRCuN5OsoeUKsu3dKY+mH/6Y7mpjqOg2HrGFUeGbDqlHZVZ8lmzlWZsWT32r12r91r99q9dq/da/favXav3Wv32r12r91r99q9dq/da/favXav3Wv32r12r91r99q9dq/da/fSr/8Pq1m10ACQAQA=
"""
EXPECTED_HEAD = "7cdc5282ae82baae5845feef579feb2a5bbc255a"
MARKER = "资料完成度"
COMMIT_MESSAGE = "fix: make receipt button actionable"
V16_SUBJECT = "feat: let workers propose cash bounties"
V15_SUBJECT = "feat: add simple cash bounties"
V14_SUBJECT = "fix: unblock finance dialogs during background refresh"
V13_SUBJECT = "fix: clarify empty cost time inputs"
V12_SUBJECT = "fix: explain disabled bounty and finance actions"
V11_SUBJECT = "feat: add task detail hours and empty states"
V10_SUBJECT = "feat: finish responsive lab tables"
V9_SUBJECT = "feat: polish lab workbench mobile and terminology"
V8_SUBJECT = "feat: refresh lab workbench with participation and task hours"
V7_SUBJECT = "feat: add participatory management and bounty shortcuts"
V6_SUBJECT = "feat: add participatory management and lazy workbench"
V5_SUBJECT = "feat: simplify stage budget setup"
V4_SUBJECT = "feat: guide external receipts and internal pool funding"
V3_SUBJECT = "feat: add dedicated incoming money workbench"
V2_SUBJECT = "feat: extend workbench styling and project switching"
V1_SUBJECT = "feat: add worker-first finance and quality workbenches"
V1_MARKER = "FinanceWorkbench"

FILES = (
    "apps/web/core/components/lab/finance.tsx",
    "docs/lab/finance-quality-workbench.md",
)
SELF_DEST = REPO / "tools/lab/deploy_finance_quality.py"
COMMIT_PATHS = (*FILES, "tools/lab/deploy_finance_quality.py")


def fail(message: str) -> None:
    raise SystemExit(message)


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", "-c", f"safe.directory={REPO}", *args],
        cwd=REPO,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        fail(f"git {' '.join(args)} 失败：\n{result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def find_node() -> Path:
    candidates = [os.environ.get("NODE_BIN"), shutil.which("node"), "/usr/bin/node"]
    candidates.extend(str(path) for path in sorted(Path("/home/qp/.nvm/versions/node").glob("*/bin/node"), reverse=True))
    for candidate in candidates:
        if candidate:
            path = Path(candidate)
            if path.is_file() and os.access(path, os.X_OK):
                return path
    fail("找不到 node。请设置 NODE_BIN=/path/to/node 后重试。")


def local_bin(*parts: str) -> Path:
    path = REPO.joinpath(*parts)
    if not path.is_file():
        fail(f"缺少构建命令：{path}")
    return path


def run(command: list[str], env: dict[str, str], cwd: Path = REPO) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def load_bundle() -> bytes:
    try:
        data = base64.b64decode("".join(BUNDLE_B64.split()), validate=True)
    except Exception as problem:  # noqa: BLE001 - report malformed embedded data
        fail(f"内嵌改版包解码失败：{problem}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != BUNDLE_SHA256:
        fail(f"改版包校验失败：期望 {BUNDLE_SHA256}，实际 {digest}")
    print(f"改版包校验通过：{digest}")
    return data

def extract_bundle(data: bytes) -> Path:
    root = Path(tempfile.mkdtemp(prefix="plane-finance-quality-"))
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive.getmembers():
                target = Path(member.name)
                if target.is_absolute() or ".." in target.parts:
                    fail(f"改版包包含不安全路径：{member.name}")
            try:
                archive.extractall(root, filter="data")
            except TypeError:
                archive.extractall(root)
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return root


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def same_as_bundle(root: Path) -> bool:
    return all((REPO / relative).is_file() and file_digest(REPO / relative) == file_digest(root / relative) for relative in FILES)


def apply_files(root: Path) -> None:
    for relative in FILES:
        source = root / relative
        if not source.is_file():
            fail(f"改版包缺少文件：{relative}")
        target = REPO / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        owner = target.stat() if target.exists() else target.parent.stat()
        shutil.copy2(source, target)
        try:
            os.chown(target, owner.st_uid, owner.st_gid)
        except OSError:
            pass
    SELF_DEST.parent.mkdir(parents=True, exist_ok=True)
    source_script = Path(__file__).resolve()
    if source_script != SELF_DEST:
        owner = SELF_DEST.stat() if SELF_DEST.exists() else SELF_DEST.parent.stat()
        shutil.copy2(source_script, SELF_DEST)
        os.chmod(SELF_DEST, 0o755)
        try:
            os.chown(SELF_DEST, owner.st_uid, owner.st_gid)
        except OSError:
            pass


def commit_changes() -> None:
    subprocess.run(["git", "-c", f"safe.directory={REPO}", "add", "--", *COMMIT_PATHS], cwd=REPO, check=True)
    staged = subprocess.run(
        ["git", "-c", f"safe.directory={REPO}", "diff", "--cached", "--quiet", "--", *COMMIT_PATHS], cwd=REPO
    )
    if staged.returncode == 0:
        print("源文件没有变化，跳过提交。")
        return
    print("+ git commit")
    subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={REPO}",
            "-c",
            "user.name=OpenOceanAcoustic Deployment",
            "-c",
            "user.email=deploy@openoceanacoustic.local",
            "commit",
            "--no-verify",
            "-m",
            COMMIT_MESSAGE,
            "--",
            *COMMIT_PATHS,
        ],
        cwd=REPO,
        check=True,
    )


def migrate_backend() -> None:
    """Apply the additive cash-bounty table and reload API routes."""
    compose = [
        "docker",
        "compose",
        "-p",
        os.environ.get("LAB_COMPOSE_PROJECT", "ooa-plane-lab"),
        "-f",
        "compose.lab.yml",
    ]
    env = os.environ.copy()
    print("正在检查现金悬赏后端代码…")
    run([*compose, "exec", "-T", "api", "python", "manage.py", "check"], env)
    run([*compose, "exec", "-T", "api", "python", "manage.py", "makemigrations", "--check", "--dry-run", "lab"], env)
    print("正在执行现金悬赏数据库迁移…")
    run([*compose, "exec", "-T", "api", "python", "manage.py", "migrate", "lab"], env)
    run([*compose, "restart", "api"], env)


def build(env: dict[str, str]) -> None:
    for package, binary in (("types", "tsdown"), ("shared-state", "tsdown"), ("ui", "tsdown")):
        command = local_bin("packages", package, "node_modules", ".bin", binary)
        run([str(command)], env, cwd=REPO / "packages" / package)
    web_build = local_bin("apps", "web", "node_modules", ".bin", "react-router")
    run([str(web_build), "build"], env, cwd=REPO / "apps" / "web")


def publish() -> Path:
    if not (BUILD / "index.html").is_file():
        fail(f"构建产物不存在：{BUILD / 'index.html'}")
    lab_bundles = [
        path for path in (BUILD / "assets").glob("*.js") if MARKER in path.read_text(errors="ignore")
    ]
    if not lab_bundles:
        fail("构建产物中没有找到新的界面代码，停止发布。")

    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "assets").mkdir(parents=True, exist_ok=True)
    backup = Path("/tmp") / f"plane-index-before-finance-quality-{int(time.time())}.html"
    if (RUNTIME / "index.html").is_file():
        shutil.copy2(RUNTIME / "index.html", backup)

    # Hashed assets are additive. Keep previous hashes available for members
    # who still have the old entry page open.
    for item in (BUILD / "assets").iterdir():
        target = RUNTIME / "assets" / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    for item in BUILD.iterdir():
        if item.name == "index.html":
            continue
        target = RUNTIME / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)

    staged = RUNTIME / ".index.html.new"
    shutil.copy2(BUILD / "index.html", staged)
    os.chmod(staged, 0o644)
    os.replace(staged, RUNTIME / "index.html")
    return lab_bundles[0]


def read_url(url: str) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=15) as response:
        return response.status, response.read()


def smoke(lab_bundle: Path, backup: Path | None) -> None:
    try:
        status, html = read_url(f"{LOCAL_URL}/")
        if status != 200:
            fail(f"首页返回 {status}")
        entry = re.search(rb'assets/[^"\']+\.js', html)
        if not entry:
            fail("首页没有引用前端资源")
        asset_url = f"{LOCAL_URL}/{entry.group(0).decode()}"
        status, _ = read_url(asset_url)
        if status != 200:
            fail(f"入口资源返回 {status}：{asset_url}")
        status, body = read_url(f"{LOCAL_URL}/assets/{lab_bundle.name}")
        if status != 200 or MARKER.encode() not in body:
            fail("线上 lab-panel 资源尚未包含新的资金与质量界面")
        try:
            public_status, _ = read_url(f"{PUBLIC_URL}/")
            print(f"公网入口 HTTP {public_status}")
        except Exception as problem:  # noqa: BLE001 - public probe is informational
            print(f"公网入口探测跳过：{problem}")
    except Exception:
        if backup is not None and backup.is_file():
            shutil.copy2(backup, RUNTIME / "index.html")
            print(f"发布校验失败，已恢复原入口页：{backup}", file=sys.stderr)
        raise


def backup_before_deploy() -> tuple[str, Path, Path]:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    previous = git("rev-parse", "HEAD")
    tag = f"backup/pre-v6-{stamp}"
    try:
        git("tag", tag, previous)
        print(f"已创建回退标签：{tag} -> {previous}")
    except SystemExit as problem:
        print(f"回退标签创建失败，继续执行：{problem}", file=sys.stderr)
    source = Path("/tmp") / f"plane-source-before-v6-{stamp}.tar.gz"
    with tarfile.open(source, "w:gz") as archive:
        for relative in FILES:
            path = REPO / relative
            if path.exists():
                archive.add(path, arcname=relative)
    print(f"源文件备份：{source}")
    runtime = Path("/tmp") / f"plane-web-before-v6-{stamp}.tar.gz"
    with tarfile.open(runtime, "w:gz") as archive:
        archive.add(RUNTIME, arcname="web")
    print(f"运行目录备份：{runtime}")
    return previous, source, runtime


def main() -> None:
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        fail("请使用 sudo python3 /tmp/deploy-finance-quality.py 运行。")
    if not (REPO / ".git").is_dir():
        fail(f"不是 Git 仓库：{REPO}")
    if not RUNTIME.is_dir():
        fail(f"没有找到运行目录：{RUNTIME}")

    dirty = git("status", "--porcelain", "--untracked-files=no")
    if dirty:
        fail("部署仓库有未提交的已跟踪修改，请先处理：\n" + dirty)

    data = load_bundle()
    root = extract_bundle(data)
    try:
        head = git("rev-parse", "HEAD")
        subject = git("log", "-1", "--format=%s")
        current_finance = (REPO / "apps/web/core/components/lab/finance.tsx").read_text(errors="ignore")
        known = head == EXPECTED_HEAD or subject in (V1_SUBJECT, V2_SUBJECT, V3_SUBJECT, V4_SUBJECT, V5_SUBJECT, V6_SUBJECT, V7_SUBJECT, V8_SUBJECT, V9_SUBJECT, V10_SUBJECT, V11_SUBJECT, V12_SUBJECT, V13_SUBJECT, V14_SUBJECT, V15_SUBJECT, V16_SUBJECT) or V1_MARKER in current_finance
        if not known and not same_as_bundle(root):
            fail(
                f"当前提交 {head} 不是可识别的改版基线，且目标文件与改版包不一致，"
                "为避免覆盖后续改动已停止。请让维护者基于当前提交重放改版。"
            )
        if same_as_bundle(root):
            print("目标文件已是当前改版版本，跳过文件安装。")
        else:
            backup = backup_before_deploy()
            print(f"部署前备份完成：{backup[1]} / {backup[2]}")
            apply_files(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    migrate_backend()
    node = find_node()
    env = os.environ.copy()
    env["PATH"] = f"{node.parent}:{env.get('PATH', '')}"
    env["NODE_ENV"] = "production"
    env["CI"] = "true"
    env["TURBO_TELEMETRY_DISABLED"] = "1"
    print(f"使用 Node：{node}")
    build(env)
    commit_changes()
    lab_bundle = publish()
    backup_candidates = sorted(Path("/tmp").glob("plane-index-before-finance-quality-*.html"))
    backup = backup_candidates[-1] if backup_candidates else None
    smoke(lab_bundle, backup)
    print("部署完成。")
    print(f"提交：{git('rev-parse', 'HEAD')}")
    print(f"本地：{LOCAL_URL}")
    print(f"正式：{PUBLIC_URL}")
    print("旧的哈希资源仍保留，入口页已最后原子替换。")
    print("如需回退：")
    print(f"  git -C {REPO} reset --hard backup/pre-v6-<时间戳>   # 或 git revert HEAD")
    print("  运行目录可解压 /tmp/plane-web-before-v6-<时间戳>.tar.gz 到 .temp/lab-runtime/")
    print("  源文件备份在 /tmp/plane-source-before-v6-<时间戳>.tar.gz")


if __name__ == "__main__":
    main()
