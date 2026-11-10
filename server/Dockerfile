FROM python:3.12-slim

WORKDIR /app/server

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Ho_Chi_Minh \
    PYTHONPATH=/app:/app/server

COPY requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY . /app/server

RUN mkdir -p /app/server/data /app/server/data/uploads /app/server/data/samples /app/client/dist-release

EXPOSE 8790

CMD ["python", "main.py"]
