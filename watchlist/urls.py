from django.urls import path
from .views import Portfolio, DeleteStock


urlpatterns = [
    path("", Portfolio, name="watchlist"),
    path("delete/<stock_symbol>", DeleteStock, name="delete"),
]
