.PHONY: dev backend frontend deploy

dev:
	docker compose up --build

backend:
	cd backend && uvicorn main:app --reload

frontend:
	cd frontend && npm run dev

deploy:
	cd backend && railway up

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install