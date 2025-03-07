# /api/index.py
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse

app = FastAPI()

@app.get("/")
def handler(request: Request):
    return PlainTextResponse("Hello, world!")
