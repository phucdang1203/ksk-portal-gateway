FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Ho_Chi_Minh \
    PYTHONPATH=/app \
    DATA_DIR=/app/server/data \
    PORT=8790 \
    UVICORN_RELOAD=false

COPY requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY . /app/server

RUN mkdir -p /app/server/data /app/server/data/uploads /app/server/data/samples /app/client/dist-release

EXPOSE 8790

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8790"]
