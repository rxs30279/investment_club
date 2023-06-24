from django.urls import path
from .views import Competition

urlpatterns = [
    path("", Competition, name="competition"),
]