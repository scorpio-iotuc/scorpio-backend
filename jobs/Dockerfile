FROM python:3.12-slim 

WORKDIR /app

COPY src/scripts/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY src/scripts/upsert_satellites.py ./upsert_satellites.py
COPY jobs/upsert_satellites_scheduler.py ./upsert_satellites_scheduler.py
COPY jobs/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]