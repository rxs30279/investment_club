from django.contrib import admin
from import_export.admin import ImportExportModelAdmin
from .models import Comp_model,Memebers


@admin.register(Comp_model)
class ViewAdmin(ImportExportModelAdmin):
    # exclude = ("id",)
    list_display = ["epic","id"]
    

class Comp_modelInline(admin.TabularInline):
    model = Memebers.member.through
    exclude = ("id",)
    list_display = ["epic","id"]


class MemebersAdmin(admin.ModelAdmin):
    inlines = [Comp_modelInline]
    list_display = ["first_name","last_name"]



admin.site.register(Memebers, MemebersAdmin)
# admin.site.register(Comp_model)

