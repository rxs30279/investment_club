from django.urls import path
from .views import Profile

urlpatterns = [
    path("", Profile, name="index"),
]
